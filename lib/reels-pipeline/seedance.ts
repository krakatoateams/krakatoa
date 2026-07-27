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
import {
  uploadAssCaptions,
  downloadAndStoreFinal,
  cleanupCaptions,
} from "./storage";
import {
  artifactFetchUrl,
  resolveSceneUrls,
  throwRecoverableIfCheckpointed,
} from "./recovery-helpers";
import type {
  ReelsPipelineContext,
  ReelsPipelineResult,
  SeedancePipelineParams,
} from "./types";

async function abortIfCancelled(ctx: ReelsPipelineContext): Promise<void> {
  if (await ctx.isCancelled()) throw new ReplicateCancellationError();
}

function rendiPollOpts(ctx: ReelsPipelineContext) {
  return { abortCheck: () => abortIfCancelled(ctx) };
}

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

  if (ctx.recovery) {
    await ctx.recovery.setPipeline("reels_seedance");
  }

  // ----- Step 1A: style anchor + negative prompt + narrator emotion -----
  await abortIfCancelled(ctx);
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
  await abortIfCancelled(ctx);
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
  await abortIfCancelled(ctx);
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

  if (ctx.recovery) {
    await ctx.recovery.copyAudioFromUrl(fullAudioUrl);
  }

  const finalDuration = TOTAL_DURATION;
  const perSceneDuration = DURATION_PER_SCENE;

  // ----- Step 5: parallel Seedance scene videos -----
  await ctx.log.beginStep("video_generation", "Parallel Seedance scene videos", {
    scenes: SCENE_COUNT,
    perSceneDuration: DURATION_PER_SCENE,
    resolution: RESOLUTION,
  });
  // Abort before kicking off the expensive parallel runs if cancelled during LLM/TTS.
  await abortIfCancelled(ctx);
  const sceneVideoRefs: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i]!;
    await abortIfCancelled(ctx);
    try {
      const res = await runWithRetry(
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
      );
      const url = extractMediaUrl(res);
      if (!url || !url.startsWith("http")) {
        throw new Error(`Failed to generate video for scene ${scene.scene_id}.`);
      }
      if (ctx.recovery) {
        const path = await ctx.recovery.copySceneFromUrl(i, url);
        sceneVideoRefs.push(path);
      } else {
        sceneVideoRefs.push(url);
      }
      if (sceneVideoRefs.length === 1 && ctx.onProviderCommitted) {
        await ctx.onProviderCommitted();
      }
    } catch (e) {
      throwRecoverableIfCheckpointed(ctx.recovery, "scenes", e);
      throw e;
    }
  }
  // Post-run cancel safety net (refund + no delivery, skip the costly Rendi stitch).
  await abortIfCancelled(ctx);
  await ctx.log.endStep({ scenes: sceneVideoRefs.length });

  // ----- Step 6: ASS subtitles + Rendi stitch/merge/burn -----
  await abortIfCancelled(ctx);
  await ctx.log.beginStep("rendi_render", "ASS subtitles + Rendi concat/merge/burn-in");
  // Seedance renders against a fixed 480x854 PlayRes (libass scales to the real
  // frame); keep this in sync with the live caption preview's 480x854 math.
  const assContent = buildAssContent(style, 480, 854, whisperWords, audioSpeedFactor, finalDuration);
  let srtFilename: string | undefined;
  let srtUrl: string;
  if (ctx.recovery) {
    const captionsPath = await ctx.recovery.uploadCaptions(assContent);
    srtUrl = await artifactFetchUrl(captionsPath, ctx.userId);
  } else {
    const uploaded = await uploadAssCaptions(ctx.userId, assContent, `captions_${Date.now()}.ass`);
    srtFilename = uploaded.srtFilename;
    srtUrl = uploaded.srtUrl;
  }

  const targetW = RESOLUTION === "720p" ? 720 : 480;
  const targetH = RESOLUTION === "720p" ? 1280 : 854;
  const perSceneDurStr = perSceneDuration.toFixed(3);
  if (ctx.recovery) {
    await ctx.recovery.setRendiParams({
      targetW,
      targetH,
      perSceneDurStr,
      audioSpeedFactor,
      finalDuration,
      shortest: false,
      fontname: style.fontname,
    });
    await ctx.recovery.setStep("rendi");
  }

  const sceneVideoUrls = await resolveSceneUrls(sceneVideoRefs, ctx.userId);
  const audioForMerge = ctx.recovery?.getManifest().artifacts.audio
    ? await artifactFetchUrl(ctx.recovery.getManifest().artifacts.audio!, ctx.userId)
    : fullAudioUrl;

  let combinedVideoUrl: string;
  let mergedVideoUrl: string;
  let rendiVideoUrl: string;
  const rendiPoll = rendiPollOpts(ctx);
  try {
    await abortIfCancelled(ctx);
    combinedVideoUrl = await concatScenes(
      sceneVideoUrls,
      perSceneDurStr,
      targetW,
      targetH,
      rendiPoll,
    );
    const fontUrl = getFontUrl(style.fontname);
    await abortIfCancelled(ctx);
    mergedVideoUrl = await mergeVideoAudioSubs({
      combinedVideoUrl,
      fullAudioUrl: audioForMerge,
      srtUrl,
      fontUrl,
      audioSpeedFactor,
      finalDuration,
      shortest: false,
      rendiOptions: rendiPoll,
    });
    await abortIfCancelled(ctx);
    rendiVideoUrl = await burnSubtitles(mergedVideoUrl, srtUrl, rendiPoll);
  } catch (e) {
    throwRecoverableIfCheckpointed(ctx.recovery, "rendi", e);
    throw e;
  }
  await ctx.log.endStep({ combinedVideoUrl, mergedVideoUrl, rendiVideoUrl });

  // ----- Step 7: download from Rendi + upload final MP4 to Supabase -----
  await abortIfCancelled(ctx);
  await ctx.log.beginStep(
    "storage_upload",
    "Download from Rendi + upload final MP4 to Supabase"
  );
  let storagePath: string;
  let publicUrl: string;
  try {
    const stored = await downloadAndStoreFinal(
      ctx.userId,
      "reelscreator",
      rendiVideoUrl,
      `video_${Date.now()}.mp4`
    );
    storagePath = stored.storagePath;
    publicUrl = stored.publicUrl;
  } catch (e) {
    throwRecoverableIfCheckpointed(ctx.recovery, "upload", e);
    throw e;
  }
  if (srtFilename) {
    await cleanupCaptions(srtFilename);
  }
  if (ctx.recovery) {
    await ctx.recovery.setStep("done");
  }
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
