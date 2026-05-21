import { NextResponse } from "next/server";
import Replicate from "replicate";
import { getSupabase } from "@/lib/supabase";
import {
  STORAGE_BUCKET,
  STORYBOARDS_TABLE,
  videosStoryboardPath,
} from "@/lib/storage-buckets";
import {
  extractMediaUrl,
  flattenReplicateTextChunks,
  runReplicateWithRetry,
  stripMarkdownFences,
} from "@/lib/replicate-server";

export const maxDuration = 300;

/*
  Supabase — add storyboard style column (run once in SQL editor):

  alter table storyboards add column if not exists storyboard_style text default 'cinematic_sketch';
*/

type SceneBreakdown = {
  scene_id: number;
  timestamp_range: string;
  visual_description: string;
  character_dialogue: string;
  mood: string;
};

const GPT5_SCENE_SYSTEM = `You are a film pre-visualization writer. Reply with ONLY valid JSON (no markdown code fences, no text before or after the JSON).

The JSON object MUST have exactly this shape:
{
  "scenes": [
    {
      "scene_id": <number 1-6>,
      "timestamp_range": "<string, e.g. 0:00-0:02.5>",
      "visual_description": "<string>",
      "character_dialogue": "<string>",
      "mood": "<string>"
    }
  ],
  "seedance_prompt": "<single string>"
}

Rules:
- "scenes" MUST be an array of exactly 6 objects, scene_id 1 through 6 in order. Timestamp ranges must partition a 15-second video (0:00 through 0:15) with no gaps or overlap.
- Each scene: concrete visual_description, character_dialogue (can be Indonesian or mixed as fits the theme), mood.
- "seedance_prompt": one plain-text prompt for Seedance 2.0 Fast (15s, 16:9, native audio). It MUST refer to the storyboard as [Image1] and align beats to the six scenes. Include overall cinematic style, lighting, atmosphere, camera language, pacing. For spoken lines use Indonesian in double quotes as Seedance expects (e.g. Dia berkata: "..." ). Describe ambient sound and music mood.`;

function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through */
  }

  const findBalanced = (
    text: string,
    open: string,
    close: string
  ): string | null => {
    const start = text.indexOf(open);
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  };

  const obj = findBalanced(cleaned, "{", "}");
  if (obj) {
    try {
      return JSON.parse(obj);
    } catch {
      /* fall through */
    }
  }
  throw new Error("No valid JSON found in GPT-5 response");
}

function isScene(o: unknown): o is SceneBreakdown {
  if (!o || typeof o !== "object") return false;
  const s = o as Record<string, unknown>;
  return (
    typeof s.scene_id === "number" &&
    typeof s.timestamp_range === "string" &&
    typeof s.visual_description === "string" &&
    typeof s.character_dialogue === "string" &&
    typeof s.mood === "string"
  );
}

function parseScenePayload(raw: string): {
  scenes: SceneBreakdown[];
  seedancePrompt: string;
} {
  const parsed = extractJson(raw) as Record<string, unknown>;
  const scenesRaw = parsed.scenes;
  if (!Array.isArray(scenesRaw) || scenesRaw.length !== 6) {
    throw new Error("GPT-5 JSON must contain exactly 6 scenes.");
  }
  const scenes: SceneBreakdown[] = [];
  for (let i = 0; i < 6; i++) {
    if (!isScene(scenesRaw[i])) {
      throw new Error(`Scene ${i + 1} is missing required fields or wrong types.`);
    }
    scenes.push(scenesRaw[i]);
  }
  for (let i = 0; i < 6; i++) {
    if (scenes[i].scene_id !== i + 1) {
      throw new Error(`Expected scene_id ${i + 1}, got ${scenes[i].scene_id}.`);
    }
  }
  const seedRaw = parsed.seedance_prompt ?? parsed.seedancePrompt;
  if (typeof seedRaw !== "string" || !seedRaw.trim()) {
    throw new Error("GPT-5 JSON must include a non-empty seedance_prompt string.");
  }
  return { scenes, seedancePrompt: seedRaw.trim() };
}

const STORYBOARD_STYLE_KEYS = [
  "cinematic_sketch",
  "painterly_color",
  "comic_book",
  "photorealistic",
  "anime_manga",
] as const;

type StoryboardStyleKey = (typeof STORYBOARD_STYLE_KEYS)[number];

const STORYBOARD_STYLE_INSTRUCTIONS: Record<StoryboardStyleKey, string> = {
  cinematic_sketch:
    "Style: cinematic storyboard sketch — pencil/ink linework, light shading, optional camera arrows, readable at a glance.",
  painterly_color:
    "Style: full color painterly storyboard — watercolor and gouache technique, warm cinematic color palette, soft edges.",
  comic_book:
    "Style: comic book storyboard — bold thick ink outlines, high contrast, flat color fills, dynamic panel composition.",
  photorealistic:
    "Style: photorealistic storyboard — rendered like film production stills, detailed lighting, realistic textures and faces.",
  anime_manga:
    "Style: anime and manga storyboard — Japanese animation linework, expressive character faces, clean ink, minimal shading.",
};

function resolveStoryboardStyle(raw: unknown): StoryboardStyleKey {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (STORYBOARD_STYLE_KEYS.includes(s as StoryboardStyleKey)) {
    return s as StoryboardStyleKey;
  }
  return "cinematic_sketch";
}

function buildStoryboardImagePrompt(
  theme: string,
  scenes: SceneBreakdown[],
  styleInstruction: string
): string {
  const blocks = scenes.map(
    (s) =>
      `Scene ${s.scene_id} (${s.timestamp_range}): Visual: ${s.visual_description}. Dialogue / lines: ${s.character_dialogue}. Mood: ${s.mood}.`
  );
  return `Create ONE single image: a professional cinematic storyboard sheet for a 15-second video.

Overall theme: "${theme}"

Panels must follow these six scenes exactly (one panel per scene, in order 1→6):

${blocks.join("\n\n")}

Layout requirements:
- Exactly SIX panels in a clear grid (e.g. 2×3 or 3×2) on one canvas.
- Each panel labeled with scene number, its timestamp range, visual description, and dialogue as on-set storyboard annotations.
- ${styleInstruction}
- Keep characters and setting consistent across panels where the story continues.
- One image only; do not output multiple files.`;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const theme = typeof body.theme === "string" ? body.theme.trim() : "";
    const storyboardStyle = resolveStoryboardStyle(body.storyboardStyle);
    const styleInstruction = STORYBOARD_STYLE_INSTRUCTIONS[storyboardStyle];
    if (!theme) {
      return NextResponse.json(
        { error: "Theme is required and cannot be empty." },
        { status: 400 }
      );
    }

    if (!process.env.REPLICATE_API_TOKEN?.trim()) {
      return NextResponse.json(
        { error: "REPLICATE_API_TOKEN is not configured." },
        { status: 500 }
      );
    }

    const replicate = new Replicate({
      auth: process.env.REPLICATE_API_TOKEN,
    });

    const MAX_JSON_ATTEMPTS = 3;
    let breakdown: { scenes: SceneBreakdown[]; seedancePrompt: string } | null =
      null;

    for (let attempt = 1; attempt <= MAX_JSON_ATTEMPTS; attempt++) {
      console.log(`[Storyboard] GPT-5 scene breakdown (attempt ${attempt}/${MAX_JSON_ATTEMPTS})...`);
      const gptOut = await runReplicateWithRetry(replicate, "openai/gpt-5", {
        input: {
          system_prompt: GPT5_SCENE_SYSTEM,
          prompt: `Video theme: ${theme}\n\nProduce the JSON with scenes and seedance_prompt as specified.`,
          reasoning_effort: "low",
          verbosity: "high",
          max_completion_tokens: 8192,
        },
      });

      const rawText = stripMarkdownFences(
        flattenReplicateTextChunks(gptOut).trim()
      );
      try {
        breakdown = parseScenePayload(rawText);
        break;
      } catch (e) {
        if (attempt === MAX_JSON_ATTEMPTS) throw e;
        console.warn("[Storyboard] JSON parse failed, retrying:", e);
      }
    }

    if (!breakdown) {
      throw new Error("GPT-5 did not return a valid scene breakdown.");
    }

    const { scenes, seedancePrompt: rawSeedancePrompt } = breakdown;
    let seedancePrompt = rawSeedancePrompt;
    if (!/\[Image1\]/i.test(seedancePrompt)) {
      seedancePrompt = `Follow the six-panel cinematic plan in [Image1] for composition and beats.\n\n${seedancePrompt}`;
    }

    const imagePrompt = buildStoryboardImagePrompt(theme, scenes, styleInstruction);

    console.log("[Storyboard] Calling openai/gpt-image-2 from scene breakdown...");
    const imageResult = await runReplicateWithRetry(
      replicate,
      "openai/gpt-image-2",
      {
        input: {
          prompt: imagePrompt,
          aspect_ratio: "3:2",
          output_format: "png",
          number_of_images: 1,
          quality: "auto",
          background: "opaque",
          moderation: "auto",
        },
      }
    );

    const rawUrl = extractMediaUrl(imageResult);
    if (!rawUrl || !rawUrl.startsWith("http")) {
      console.error("[Storyboard] Unexpected gpt-image-2 output:", imageResult);
      return NextResponse.json(
        { error: "Failed to resolve storyboard image URL from model output." },
        { status: 500 }
      );
    }

    console.log("[Storyboard] Downloading image from Replicate...");
    const imgRes = await fetch(rawUrl);
    if (!imgRes.ok) {
      throw new Error(
        `Failed to download storyboard image: ${imgRes.status} ${imgRes.statusText}`
      );
    }
    const imageBuffer = await imgRes.arrayBuffer();

    const filename = `storyboard_${Date.now()}.png`;
    const storagePath = videosStoryboardPath(filename);
    const supabase = getSupabase();

    console.log("[Storyboard] Uploading to Supabase:", storagePath);
    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, imageBuffer, {
        contentType: "image/png",
        cacheControl: "3600",
        upsert: false,
      });

    if (uploadError) {
      console.error("[Storyboard] Upload error:", uploadError);
      return NextResponse.json(
        { error: `Failed to upload storyboard: ${uploadError.message}` },
        { status: 500 }
      );
    }

    const {
      data: { publicUrl: storyboardUrl },
    } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);

    const scene_breakdown = { scenes };

    console.log("[Storyboard] Inserting row into", STORYBOARDS_TABLE);
    const { data: inserted, error: insertError } = await supabase
      .from(STORYBOARDS_TABLE)
      .insert({
        theme,
        storyboard_url: storyboardUrl,
        seedance_prompt: seedancePrompt,
        scene_breakdown,
        storyboard_style: storyboardStyle,
        status: "ready",
      })
      .select("id")
      .single();

    if (insertError || !inserted?.id) {
      console.error("[Storyboard] DB insert error:", insertError);
      return NextResponse.json(
        { error: insertError?.message || "Failed to save storyboard record." },
        { status: 500 }
      );
    }

    console.log("[Storyboard] Done:", storyboardUrl, "id:", inserted.id);
    return NextResponse.json({
      storyboardId: inserted.id,
      storyboardUrl,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.error("[Storyboard] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
