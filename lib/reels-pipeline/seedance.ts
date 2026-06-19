/**
 * Seedance reels pipeline (engine = "seedance").
 *
 * Lifted from the legacy `app/api/generate/route.ts`: two-step LLM (style anchor
 * + scene breakdown) → single continuous MiniMax TTS measured by Whisper →
 * parallel per-scene Seedance video → ASS subtitles → Rendi normalize/concat/
 * merge/burn → Supabase upload. The HTTP route owns credits, jobs, and history;
 * this function only produces the final video + metadata.
 */
import { runWithRetry } from "@/lib/reels-helpers";
import { extractMediaUrl, ReplicateCancellationError } from "@/lib/replicate-server";
import { buildAssContent } from "./ass";
import { generateSeedanceStyle, generateScenes } from "./llm";
import { runTtsPipeline } from "./tts-whisper";
import {
  concatScenes,
  mergeVideoAudioSubs,
  burnSubtitles,
  getFontUrl,
} from "./rendi-stitch";
import { uploadAssCaptions, downloadAndStoreFinal, cleanupCaptions } from "./storage";
import type {
  ReelsPipelineContext,
  ReelsPipelineResult,
  SeedancePipelineParams,
} from "./types";

export async function runSeedancePipeline(
  ctx: ReelsPipelineContext,
  params: SeedancePipelineParams
): Promise<ReelsPipelineResult> {
  const { theme, sceneCount, durationPerScene, resolution, voiceId, emotion, style } =
    params;

  const SCENE_COUNT = sceneCount;
  const DURATION_PER_SCENE = durationPerScene;
  const TOTAL_DURATION = SCENE_COUNT * DURATION_PER_SCENE;
  const RESOLUTION = resolution;

  // ----- Step 1A: style anchor + negative prompt + narrator emotion -----
  await ctx.log.beginStep(
    "style_anchor",
    "LLM style anchor + negative prompt + narrator emotion"
  );
  const { styleAnchor, negativePrompt, narratorEmotion } = await generateSeedanceStyle(
    ctx,
    { theme, userEmotion: emotion }
  );
  await ctx.log.endStep({ styleAnchor, negativePrompt, narratorEmotion });

  // ----- Step 1B: scene breakdown -----
  const MAX_WORDS_PER_SCENE = Math.max(6, Math.floor(DURATION_PER_SCENE * 1.7));
  await ctx.log.beginStep("scene_breakdown", "LLM scene breakdown", {
    sceneCount: SCENE_COUNT,
    maxWordsPerScene: MAX_WORDS_PER_SCENE,
  });
  const systemPrompt = `You are a video producer. The user gives a theme. Return a JSON array of exactly ${SCENE_COUNT} scene(s) to make a faceless video (Reels/TikTok).
All scenes must exist in the same visual world and location.

STYLE ANCHOR (append this exact string verbatim at the end of every video_prompt):
"${styleAnchor}"

NARRATION RULES (CRITICAL):
- The narrations from all scenes will be JOINED with spaces and spoken as ONE continuous monologue by a single narrator.
- Write them as one flowing story split into scene-sized chunks. Each scene's narration must connect naturally to the next.
- Use connective phrases between scenes ("but then…", "suddenly…", "what happens next…", "and that's when…") so the listener never feels a hard cut.
- DO NOT repeat information between scenes.
- DO NOT start a scene's narration with a phrase that only makes sense in isolation (e.g., "Welcome back!").
- Each scene's narration MUST be ${MAX_WORDS_PER_SCENE} words or fewer.
- Spell out digits as words ("100" → "one hundred") for clean TTS pronunciation.

Each scene must have:
- "scene_id": number (e.g., 1)
- "video_prompt": string (highly detailed visual description for a text-to-video model. CRITICAL: Every video_prompt MUST end with the literal STYLE ANCHOR string above, copied exactly. Do NOT write the words "the style anchor" — copy the actual descriptors.)
- "narration": string (voiceover text following the NARRATION RULES above)

Return ONLY raw JSON array, nothing else.`;
  const scenes = await generateScenes(ctx, {
    theme,
    sceneCount: SCENE_COUNT,
    systemPrompt,
    styleAnchor,
    maxWordsPerScene: MAX_WORDS_PER_SCENE,
  });
  await ctx.log.endStep({ sceneCount: scenes.length });

  const fullNarration = scenes
    .map((s) => String(s.narration || "").trim())
    .filter(Boolean)
    .join(" ");
  if (!fullNarration) {
    throw new Error("All scene narrations are empty — LLM failed to produce a script.");
  }

  // ----- Step 2+3: TTS + Whisper (speed-fit retry, initial speed 1.0) -----
  await ctx.log.beginStep(
    "tts_generation",
    "MiniMax TTS voiceover (with speed-fit retry)",
    { voiceId, emotion: narratorEmotion }
  );
  const { audioUrl: fullAudioUrl, words: whisperWords, audioEndTotal, audioSpeedFactor, retried } =
    await runTtsPipeline(ctx, {
      fullNarration,
      voiceId,
      emotion: narratorEmotion,
      totalDuration: TOTAL_DURATION,
      initialSpeed: 1.0,
    });
  await ctx.log.endStep({ retried, audioSpeedFactor });
  await ctx.log.beginStep("whisper_transcription", "Whisper word-level transcription", {
    measuredDuration: audioEndTotal,
  });
  await ctx.log.endStep({ wordCount: whisperWords.length, measuredDuration: audioEndTotal });

  const finalDuration = TOTAL_DURATION;
  const perSceneDuration = DURATION_PER_SCENE;

  // ----- Step 5: parallel Seedance scene videos -----
  await ctx.log.beginStep("video_generation", "Parallel Seedance scene videos", {
    scenes: SCENE_COUNT,
    perSceneDuration: DURATION_PER_SCENE,
    resolution: RESOLUTION,
  });
  // Abort before kicking off the expensive parallel runs if cancelled during LLM/TTS.
  if (await ctx.isCancelled()) throw new ReplicateCancellationError();
  const videoResponses = await Promise.all(
    scenes.map((scene) =>
      runWithRetry(
        ctx.replicate,
        ctx.refs.videoRef,
        {
          input: {
            prompt: scene.video_prompt,
            aspect_ratio: "9:16",
            negative_prompt: negativePrompt,
            duration: DURATION_PER_SCENE,
            resolution: RESOLUTION,
            generate_audio: false,
          },
        },
        10,
        ctx.recorder
      )
    )
  );
  // Post-run cancel safety net (refund + no delivery, skip the costly Rendi stitch).
  if (await ctx.isCancelled()) throw new ReplicateCancellationError();
  const sceneVideoUrls = videoResponses.map((res, i) => {
    const url = extractMediaUrl(res);
    if (!url || !url.startsWith("http")) {
      console.error(`Failed to extract video URL for scene ${scenes[i].scene_id}:`, res);
      throw new Error(`Failed to generate video for scene ${scenes[i].scene_id}.`);
    }
    return url;
  });
  await ctx.log.endStep({ scenes: sceneVideoUrls.length });

  // ----- Step 6: ASS subtitles + Rendi stitch/merge/burn -----
  await ctx.log.beginStep("rendi_render", "ASS subtitles + Rendi concat/merge/burn-in");
  // Seedance renders against a fixed 480x854 PlayRes (libass scales to the real
  // frame); keep this in sync with the live caption preview's 480x854 math.
  const assContent = buildAssContent(style, 480, 854, whisperWords, audioSpeedFactor, finalDuration);
  const { srtFilename, srtUrl } = await uploadAssCaptions(
    assContent,
    `captions_${Date.now()}.ass`
  );

  const targetW = RESOLUTION === "720p" ? 720 : 480;
  const targetH = RESOLUTION === "720p" ? 1280 : 854;
  const perSceneDurStr = perSceneDuration.toFixed(3);
  const combinedVideoUrl = await concatScenes(sceneVideoUrls, perSceneDurStr, targetW, targetH);
  const fontUrl = getFontUrl(style.fontname);
  const mergedVideoUrl = await mergeVideoAudioSubs({
    combinedVideoUrl,
    fullAudioUrl,
    srtUrl,
    fontUrl,
    audioSpeedFactor,
    finalDuration,
    shortest: false,
  });
  const rendiVideoUrl = await burnSubtitles(mergedVideoUrl, srtUrl);
  await ctx.log.endStep({ combinedVideoUrl, mergedVideoUrl, rendiVideoUrl });

  // ----- Step 7: download from Rendi + upload final MP4 to Supabase -----
  await ctx.log.beginStep(
    "storage_upload",
    "Download from Rendi + upload final MP4 to Supabase"
  );
  const { storagePath, publicUrl } = await downloadAndStoreFinal(
    rendiVideoUrl,
    `reels_${Date.now()}.mp4`
  );
  await cleanupCaptions(srtFilename);
  await ctx.log.endStep({ storagePath, publicUrl });

  return {
    videoUrl: publicUrl,
    storagePath,
    width: targetW,
    height: targetH,
    durationSec: finalDuration,
    narration: fullNarration,
    scenePrompts: scenes.map((s) => String(s.video_prompt || "")),
  };
}
