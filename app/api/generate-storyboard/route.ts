import { NextResponse } from "next/server";
import Replicate from "replicate";
import { insertUserCreation } from "@/lib/creations-db";
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
import { requireCurrentProfile } from "@/lib/profiles-db";
import { createJob, startJob, finishJob, failJob } from "@/lib/jobs-db";
import { createJobStep, finishJobStep, failJobStep } from "@/lib/job-steps-db";
import { createProcessingAsset, markAssetReady, markAssetFailed } from "@/lib/assets-db";
import {
  spendCredits,
  refundCredits,
  getWallet,
  InsufficientCreditsError,
} from "@/lib/credits-db";
import { getStoryboardImageCredits, PricingConfigError } from "@/lib/pricing-resolver";
import { getStoryboardModels, replicateRef } from "@/lib/model-resolver";
import { assertToolEnabled, ToolDisabledError } from "@/lib/tool-access";
import { recordUsageEvent } from "@/lib/usage-events-db";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  computeRequestHash,
  beginGenerationRequest,
  finishGenerationRequestSuccess,
  finishGenerationRequestFailure,
} from "@/lib/generation-idempotency";

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
  // Platform-observability trackers — declared before the try so the catch block
  // and early-return error paths can finalize whatever was created. They stay
  // null when observability is skipped, making every platform write a no-op.
  let profileId: string | null = null;
  let jobId: string | null = null;
  let currentStepId: string | null = null;
  let imageAssetId: string | null = null;
  // Credit-spend trackers — see app/api/generate/route.ts for the pattern.
  let creditsSpent = false;
  let creditsAmount = 0;
  // Request-level idempotency row id (Double-Charge Protection v1).
  let generationRequestId: string | null = null;

  // Best-effort wrapper: platform writes must NEVER crash generation or mask the
  // original error.
  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[storyboard obs] ${label} failed:`, e);
      return null;
    }
  };

  try {
    // STRICT profile resolution — this route now charges credits. See
    // app/api/generate/route.ts for the rationale; non-auth failures now
    // surface as 500 rather than silently allowing free generation.
    //   profile.id      -> platform tables (jobs / job_steps / assets) + credits
    //   profile.user_id -> legacy storyboards.user_id + user_creations (= users.id)
    let userId: string | null = null;
    try {
      const profile = await requireCurrentProfile();
      profileId = profile.id;
      userId = profile.user_id;
    } catch (e) {
      if (e instanceof Error && /not authenticated/i.test(e.message)) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
      console.error("[storyboard] profile resolution failed (non-auth):", e);
      return NextResponse.json(
        { error: "Profile resolution failed. Please try again." },
        { status: 500 }
      );
    }

    // ---- Tool-access guard (Admin Phase 2) ----
    // Storyboard is an engine inside the Reels tool, so it maps to tool_key 'reels'.
    // Returns 403 only when an admin disabled it; missing config / DB errors fail open.
    try {
      await assertToolEnabled("reels");
    } catch (e) {
      if (e instanceof ToolDisabledError) {
        return NextResponse.json(
          { error: e.message, code: "TOOL_DISABLED" },
          { status: 403 }
        );
      }
      console.warn("[storyboard] tool guard unexpected error (failing open):", e);
    }

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

    // ---- Resolve runtime models (Admin Phase 2) ----
    // DB-backed config with fallback. The image model is the billed/recorded
    // model and is reused across createJob, createProcessingAsset, the image
    // provider call, and recordUsageEvent. The scene LLM is resolved separately
    // for the breakdown call.
    const { sceneLlm: sceneLlmModel, image: imageModel } = await getStoryboardModels();
    const sceneLlmRef = replicateRef(sceneLlmModel);
    const imageModelRef = replicateRef(imageModel);

    // ---- Request-level idempotency gate (Double-Charge Protection v1) ----
    // MUST run before createJob, spendCredits, or any provider call. Hash uses
    // normalized client inputs only (never the key, pricing, or model config).
    const idemKey = readIdempotencyKey(req);
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 }
      );
    }
    const requestHash = computeRequestHash({ theme, storyboardStyle });
    const begin = await beginGenerationRequest({
      profileId: profileId!,
      idempotencyKey: idemKey,
      routeKey: "generate_storyboard",
      toolKey: "reels",
      requestHash,
    });
    if (begin.action === "conflict") {
      return NextResponse.json(
        {
          error: "This idempotency key was already used with a different request.",
          code: "IDEMPOTENCY_CONFLICT",
        },
        { status: 409 }
      );
    }
    if (begin.action === "in_progress") {
      return NextResponse.json(
        { error: "Generation already in progress, please wait.", code: "GENERATION_IN_PROGRESS" },
        { status: 409 }
      );
    }
    if (begin.action === "replay") {
      return NextResponse.json(begin.response);
    }
    generationRequestId = begin.id;

    // ---- Platform job (best-effort observability) ----
    // Asset creation is deferred until after the credit spend succeeds.
    const job = await safe("createJob", () => createJob({
      profileId: profileId!,
      tool: "storyboard",
      jobType: "storyboard_image",
      provider: imageModel.provider,
      model: imageModel.model,
      input: { theme: theme.slice(0, 500), storyboardStyle },
    }));
    if (job) {
      jobId = job.id;
      await safe("startJob", () => startJob(profileId!, jobId!));
    }

    // ---- Credit spend (BUSINESS LOGIC — not safe-wrapped) ----
    // Storyboard image is priced from the GPT Image 2 `auto` tier provider cost
    // (v2.2 default 12 credits). Insufficient → 402 with no provider call; other
    // infra failures bubble to outer catch as 500.
    const requiredCredits = await getStoryboardImageCredits();
    try {
      await spendCredits({
        profileId: profileId!,
        amount: requiredCredits,
        idempotencyKey: jobId
          ? `spend:storyboard_image:${jobId}`
          : `spend:storyboard_image:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: "Storyboard image generation",
        metadata: {
          tool: "storyboard",
          jobType: "storyboard_image",
          storyboardStyle,
        },
      });
      creditsSpent = true;
      creditsAmount = requiredCredits;
    } catch (e) {
      if (e instanceof InsufficientCreditsError) {
        const wallet = await getWallet(profileId!).catch(() => null);
        const currentBalance = wallet?.balance ?? 0;
        if (jobId) {
          await safe("failJobInsufficient", () => failJob(profileId!, jobId!, {
            code: "INSUFFICIENT_CREDITS",
            message: "Insufficient credits.",
            requiredCredits,
            currentBalance,
          }));
        }
        if (generationRequestId) {
          await safe("idemFailInsufficient", () => finishGenerationRequestFailure({
            id: generationRequestId!,
            jobId: jobId ?? null,
            errorJson: {
              code: "INSUFFICIENT_CREDITS",
              message: "Insufficient credits.",
              requiredCredits,
              currentBalance,
            },
          }));
        }
        return NextResponse.json(
          { error: "Insufficient credits.", requiredCredits, currentBalance },
          { status: 402 }
        );
      }
      throw e;
    }

    // ---- Processing asset (created AFTER spend succeeds) ----
    const asset = await safe("createAsset", () => createProcessingAsset({
      profileId: profileId!,
      jobId: jobId ?? undefined,
      tool: "storyboard",
      assetType: "image",
      role: "storyboard_image",
      provider: imageModel.provider,
      model: imageModel.model,
      metadata: { storyboardStyle, theme: theme.slice(0, 200) },
    }));
    if (asset) imageAssetId = asset.id;

    // Step-recording helpers (best-effort; manage currentStepId).
    const beginStep = async (stepKey: string, stepName: string, input?: Record<string, unknown>): Promise<void> => {
      if (!jobId || !profileId) return;
      const row = await safe(`beginStep:${stepKey}`, () => createJobStep({
        jobId: jobId!,
        profileId: profileId!,
        stepKey,
        stepName,
        status: "running",
        input,
      }));
      currentStepId = row?.id ?? null;
    };
    const endStep = async (output?: Record<string, unknown>): Promise<void> => {
      const id = currentStepId;
      currentStepId = null;
      if (id && profileId) {
        await safe("finishStep", () => finishJobStep(profileId!, id, output));
      }
    };

    await beginStep("scene_breakdown", "GPT-5 scene breakdown + seedance prompt");
    const MAX_JSON_ATTEMPTS = 3;
    let breakdown: { scenes: SceneBreakdown[]; seedancePrompt: string } | null =
      null;

    for (let attempt = 1; attempt <= MAX_JSON_ATTEMPTS; attempt++) {
      console.log(`[Storyboard] Scene breakdown via ${sceneLlmRef} (attempt ${attempt}/${MAX_JSON_ATTEMPTS})...`);
      const gptOut = await runReplicateWithRetry(replicate, sceneLlmRef, {
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
    await endStep({ scenes: breakdown.scenes.length });

    const { scenes, seedancePrompt: rawSeedancePrompt } = breakdown;
    let seedancePrompt = rawSeedancePrompt;
    if (!/\[Image1\]/i.test(seedancePrompt)) {
      seedancePrompt = `Follow the six-panel cinematic plan in [Image1] for composition and beats.\n\n${seedancePrompt}`;
    }

    const imagePrompt = buildStoryboardImagePrompt(theme, scenes, styleInstruction);

    await beginStep("image_generation", "GPT Image storyboard sheet");
    console.log(`[Storyboard] Calling ${imageModelRef} from scene breakdown...`);
    const imageResult = await runReplicateWithRetry(
      replicate,
      imageModelRef,
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
      throw new Error("Failed to resolve storyboard image URL from model output.");
    }
    await endStep({ imageUrl: rawUrl });

    await beginStep("storage_upload", "Download storyboard image + upload to Supabase");
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
      throw new Error(`Failed to upload storyboard: ${uploadError.message}`);
    }

    const {
      data: { publicUrl: storyboardUrl },
    } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    await endStep({ storagePath, publicUrl: storyboardUrl });

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
        user_id: userId,
      })
      .select("id")
      .single();

    if (insertError || !inserted?.id) {
      console.error("[Storyboard] DB insert error:", insertError);
      throw new Error(insertError?.message || "Failed to save storyboard record.");
    }

    // Attach storyboardId into the asset metadata only AFTER the legacy storyboards
    // insert succeeds, then mark the image asset ready and finish the job.
    // costCredits on both is a display snapshot — credit_transactions is the truth.
    if (imageAssetId && profileId) {
      await safe("markAssetReady", () => markAssetReady(profileId!, imageAssetId!, {
        storagePath,
        publicUrl: storyboardUrl,
        mimeType: "image/png",
        costCredits: creditsAmount,
        metadata: { storyboardId: inserted.id, storyboardStyle, theme: theme.slice(0, 200) },
      }));
    }
    if (jobId && profileId) {
      await safe("finishJob", () => finishJob(profileId!, jobId!, {
        output: { storyboardId: inserted.id, storyboardUrl, storagePath, assetId: imageAssetId },
        costCredits: creditsAmount,
      }));
    }

    // Usage event — analytics only, NEVER affects billing/response.
    await safe("recordUsage", () => recordUsageEvent({
      profileId: profileId!,
      jobId: jobId ?? null,
      assetId: imageAssetId ?? null,
      tool: "storyboard",
      provider: imageModel.provider,
      model: imageModel.model,
      unitType: "images",
      units: 1,
      creditsCharged: creditsAmount,
      metadata: { jobType: "storyboard_image", storyboardStyle, storyboardId: inserted.id },
    }));

    let historyItem;
    try {
      historyItem = await insertUserCreation({
        userId: userId as string,
        tool: "storyboard",
        mediaType: "image",
        mediaUrl: storyboardUrl,
        storagePath,
        title: theme.slice(0, 200),
        metadata: {
          storyboardId: inserted.id,
          storyboardStyle,
        },
      });
    } catch (historyErr) {
      console.warn("[Storyboard] History log failed:", historyErr);
    }

    console.log("[Storyboard] Done:", storyboardUrl, "id:", inserted.id);
    const successResponse = {
      storyboardId: inserted.id,
      storyboardUrl,
      historyItem,
    };
    if (generationRequestId) {
      await safe("idemSuccess", () => finishGenerationRequestSuccess({
        id: generationRequestId!,
        jobId: jobId ?? null,
        assetId: imageAssetId ?? null,
        responseJson: successResponse,
      }));
    }
    return NextResponse.json(successResponse);
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.error("[Storyboard] Error:", error);
    // Pricing fail-closed (v2.2): an unknown pricing key throws BEFORE the spend
    // and any provider call, so no credits were charged and no provider ran.
    const pricingMissing = error instanceof PricingConfigError;
    // Best-effort failure marking — must not throw or mask the original error.
    const errJson = pricingMissing
      ? { message, code: "PRICING_CONFIG_MISSING" }
      : { message };
    if (currentStepId && profileId) {
      await safe("failStep", () => failJobStep(profileId!, currentStepId!, errJson));
      currentStepId = null;
    }
    if (imageAssetId && profileId) {
      await safe("failAsset", () => markAssetFailed(profileId!, imageAssetId!, errJson));
    }
    if (jobId && profileId) {
      await safe("failJob", () => failJob(profileId!, jobId!, errJson));
    }

    // Best-effort refund. Only fires when spendCredits actually succeeded.
    if (creditsSpent && profileId && creditsAmount > 0) {
      await safe("refundCredits", () => refundCredits({
        profileId: profileId!,
        amount: creditsAmount,
        idempotencyKey: jobId
          ? `refund:storyboard_image:${jobId}`
          : `refund:storyboard_image:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: "Best-effort refund after generation failure",
        metadata: { reason: "generation_failed", originalError: errJson },
      }));
    }

    if (generationRequestId) {
      await safe("idemFailure", () => finishGenerationRequestFailure({
        id: generationRequestId!,
        jobId: jobId ?? null,
        errorJson: errJson,
      }));
    }

    return NextResponse.json(
      pricingMissing ? { error: message, code: "PRICING_CONFIG_MISSING" } : { error: message },
      { status: 500 }
    );
  }
}
