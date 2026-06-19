/**
 * LLM scripting steps shared by the reels pipelines (Gemini via Replicate).
 *
 *  - generateSeedanceStyle: 3-field style call (style_anchor + negative_prompt +
 *    narrator_emotion) used by Seedance, which resolves "auto" against the
 *    LLM-suggested MiniMax emotion.
 *  - generateVeoStyle: 2-field style call (style_anchor + negative_prompt) used
 *    by both Veo modes (Veo derives narration audio differently).
 *  - generateScenes: the shared 3-attempt scene-breakdown loop with the
 *    style-anchor append + per-scene word-cap safety nets. The engine-specific
 *    system prompt text is passed in so each engine keeps its exact wording.
 */
import { runWithRetry, extractJson } from "@/lib/reels-helpers";
import type { ReelsPipelineContext } from "./types";

/** MiniMax speech-02-turbo supported emotions (+ "auto"). */
export const VALID_EMOTIONS = [
  "auto",
  "happy",
  "sad",
  "angry",
  "fearful",
  "disgusted",
  "surprised",
  "calm",
  "fluent",
  "neutral",
];

export async function generateSeedanceStyle(
  ctx: ReelsPipelineContext,
  params: { theme: string; userEmotion: string }
): Promise<{ styleAnchor: string; negativePrompt: string; narratorEmotion: string }> {
  const styleSystemPrompt = `You are a cinematographer and audio director. Given a video theme, return a JSON object with exactly three fields:
- style_anchor: comma-separated string of 6-8 visual descriptors defining the consistent look, setting, lighting, and style for ALL scenes (always include photorealistic and 9:16 vertical)
- negative_prompt: comma-separated list of visual things to avoid
- narrator_emotion: ONE of these exact values describing the storytelling voice mood — "auto", "happy", "sad", "angry", "fearful", "disgusted", "surprised", "calm", "fluent", "neutral". Use "auto" only when no specific mood fits.
Return ONLY raw JSON, nothing else.`;

  const styleLlmOutput = await runWithRetry(
    ctx.replicate,
    ctx.refs.llmRef,
    {
      input: {
        prompt: params.theme,
        system_instruction: styleSystemPrompt,
        max_output_tokens: 512,
        temperature: 0.7,
        thinking_budget: 0,
      },
    },
    10,
    ctx.recorder
  );
  const styleRawJson = Array.isArray(styleLlmOutput)
    ? styleLlmOutput.join("")
    : String(styleLlmOutput);

  let styleAnchor = "";
  let negativePrompt = "";
  let llmSuggestedEmotion = "auto";
  try {
    const styleData = extractJson(styleRawJson) as Record<string, unknown>;
    styleAnchor = String(styleData.style_anchor || "photorealistic, 9:16 vertical");
    negativePrompt = String(styleData.negative_prompt || "ugly, broken, blurry");
    const emo = String(styleData.narrator_emotion || "").toLowerCase().trim();
    llmSuggestedEmotion = VALID_EMOTIONS.includes(emo) ? emo : "auto";
  } catch {
    console.warn("Failed to parse style JSON, using fallbacks:", styleRawJson);
    styleAnchor = "photorealistic, highly detailed, cinematic lighting, 9:16 vertical";
    negativePrompt = "blurry, low quality, distorted, watermark";
  }

  // User's explicit choice wins; "auto" (or anything invalid) defers to the LLM.
  const ue = String(params.userEmotion || "auto").toLowerCase();
  const narratorEmotion =
    ue === "auto" || !VALID_EMOTIONS.includes(ue) ? llmSuggestedEmotion : ue;

  return { styleAnchor, negativePrompt, narratorEmotion };
}

export async function generateVeoStyle(
  ctx: ReelsPipelineContext,
  params: { theme: string }
): Promise<{ styleAnchor: string; negativePrompt: string }> {
  const styleSystemPrompt = `You are a cinematographer. Given a video theme, return a JSON object with exactly two fields:
- style_anchor: comma-separated string of 6-8 visual descriptors (always include photorealistic and 9:16 vertical)
- negative_prompt: comma-separated list of visual things to avoid
Return ONLY raw JSON, nothing else.`;

  const styleLlmOutput = await runWithRetry(
    ctx.replicate,
    ctx.refs.llmRef,
    {
      input: {
        prompt: params.theme,
        system_instruction: styleSystemPrompt,
        max_output_tokens: 512,
        temperature: 0.7,
        thinking_budget: 0,
      },
    },
    10,
    ctx.recorder
  );
  const styleRaw = Array.isArray(styleLlmOutput)
    ? styleLlmOutput.join("")
    : String(styleLlmOutput);

  let styleAnchor = "photorealistic, highly detailed, cinematic lighting, 9:16 vertical";
  let negativePrompt = "blurry, low quality, distorted, watermark";
  try {
    const styleData = extractJson(styleRaw) as Record<string, unknown>;
    styleAnchor = String(styleData.style_anchor || styleAnchor);
    negativePrompt = String(styleData.negative_prompt || negativePrompt);
  } catch {
    console.warn("[reels] Veo style JSON parse failed, using defaults");
  }
  return { styleAnchor, negativePrompt };
}

/**
 * Run the scene-breakdown LLM up to 3 times until it returns exactly
 * `sceneCount` scenes, then apply the two safety nets every engine relies on:
 *   1. Ensure each video_prompt ends with the verbatim style anchor (strip any
 *      hallucinated "the style anchor" phrasing first).
 *   2. Hard-truncate each narration to `maxWordsPerScene` words.
 */
export async function generateScenes(
  ctx: ReelsPipelineContext,
  params: {
    theme: string;
    sceneCount: number;
    systemPrompt: string;
    styleAnchor: string;
    maxWordsPerScene: number;
  }
): Promise<{ scene_id: number; video_prompt: string; narration: string }[]> {
  const { theme, sceneCount, systemPrompt, styleAnchor, maxWordsPerScene } = params;

  let scenes: { scene_id: number; video_prompt: string; narration: string }[] = [];
  let lastRaw = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    const llmOutput = await runWithRetry(
      ctx.replicate,
      ctx.refs.llmRef,
      {
        input: {
          prompt: theme,
          system_instruction: systemPrompt,
          max_output_tokens: 1500,
          temperature: 0.8,
          dynamic_thinking: true,
        },
      },
      10,
      ctx.recorder
    );
    lastRaw = Array.isArray(llmOutput) ? llmOutput.join("") : String(llmOutput);
    try {
      const parsed = extractJson(lastRaw) as
        | { scene_id: number; video_prompt: string; narration: string }[]
        | { scenes?: { scene_id: number; video_prompt: string; narration: string }[] };
      const arr = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.scenes)
          ? parsed.scenes
          : null;
      if (Array.isArray(arr) && arr.length === sceneCount) {
        scenes = arr;
        break;
      }
      console.warn(
        `[reels scene breakdown attempt ${attempt}] expected ${sceneCount} scenes`
      );
    } catch {
      console.warn(
        `[reels scene breakdown attempt ${attempt}] JSON parse failed:`,
        lastRaw.slice(0, 300)
      );
    }
  }

  if (!Array.isArray(scenes) || scenes.length !== sceneCount) {
    console.error(
      "Failed to get correct scene count after 3 attempts. Last raw output:",
      lastRaw
    );
    throw new Error(`LLM did not return exactly ${sceneCount} scene(s) after 3 attempts.`);
  }

  for (const scene of scenes) {
    let p = String(scene.video_prompt || "").trim();
    p = p.replace(/[,.\s]*and\s+the\s+style\s+anchor\.?\s*$/i, "");
    p = p.replace(/[,.\s]*the\s+style\s+anchor\.?\s*$/i, "");
    if (!p.toLowerCase().includes(styleAnchor.toLowerCase().slice(0, 20))) {
      p = `${p.replace(/[.,\s]+$/, "")}, ${styleAnchor}`;
    }
    scene.video_prompt = p;

    const narrationWords = String(scene.narration || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    scene.narration = narrationWords.slice(0, maxWordsPerScene).join(" ");
  }

  return scenes;
}
