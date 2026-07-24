/**
 * Veo reels pipelines (engine = "veo").
 *
 * Lifted from the legacy `app/api/generate-veo/route.ts`:
 *   - runVeoSinglePipeline: one Veo call (with native audio) → extract audio →
 *     Whisper → ASS subtitles → burn-in. The model speaks; no MiniMax TTS.
 *   - runVeoPerScenePipeline: scene-breakdown LLM → parallel per-scene Veo runs
 *     concurrent with a MiniMax TTS pass → continuous-TTS-to-concat-timeline
 *     subtitle mapping → Rendi normalize/concat/merge/burn.
 * The HTTP route owns credits, jobs, and history; these only produce the final
 * video + metadata.
 */
import { runWithRetry } from "@/lib/reels-helpers";
import { extractMediaUrl, ReplicateCancellationError } from "@/lib/replicate-server";
import { buildAssContent } from "./ass";
import { generateVeoStyle, generateScenes } from "./llm";
import { runTtsPipeline, parseWhisperWords } from "./tts-whisper";
import {
  concatScenes,
  mergeVideoAudioSubs,
  burnSubtitles,
  extractVeoAudio,
  getFontUrl,
} from "./rendi-stitch";
import { uploadAssCaptions, downloadAndStoreFinal, cleanupCaptions } from "./storage";
import type {
  ReelsPipelineContext,
  ReelsPipelineResult,
  VeoSinglePipelineParams,
  VeoPerScenePipelineParams,
  WordChunk,
} from "./types";

function humanizeVoiceId(id: string): string {
  return id
    .replace(/^English_/, "")
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function dimsForResolution(res: "720p" | "1080p"): { w: number; h: number } {
  return res === "1080p" ? { w: 1080, h: 1920 } : { w: 720, h: 1280 };
}

/** Map Whisper timestamps (continuous TTS) onto the concatenated per-scene video timeline. */
function mapWhisperToPerSceneVideoTimeline(
  words: WordChunk[],
  sceneRanges: { start: number; end: number; index: number }[],
  sceneDuration: number,
  audioEndTotal: number,
  audioSpeedFactor: number,
  totalDuration: number
): WordChunk[] {
  if (sceneRanges.length === 0) return [];
  sceneRanges[sceneRanges.length - 1].end = audioEndTotal;

  const rangeForTime = (t: number) => {
    for (const r of sceneRanges) {
      if (t >= r.start && t < r.end) return r;
    }
    return sceneRanges[sceneRanges.length - 1];
  };

  const out: WordChunk[] = [];
  for (const w of words) {
    const r = rangeForTime(w.start);
    const span = Math.max(1e-6, r.end - r.start);
    const local0 = ((w.start - r.start) / span) * sceneDuration;
    const local1 = ((w.end - r.start) / span) * sceneDuration;
    const g0 = r.index * sceneDuration + local0;
    const g1 = r.index * sceneDuration + local1;
    out.push({
      text: w.text,
      start: g0 / audioSpeedFactor,
      end: Math.min(g1 / audioSpeedFactor, totalDuration),
    });
  }
  return out;
}

export async function runVeoSinglePipeline(
  ctx: ReelsPipelineContext,
  params: VeoSinglePipelineParams
): Promise<ReelsPipelineResult> {
  const { theme, duration, resolution, voiceId, emotion, singlePromptScenes, style } =
    params;
  const { w: targetW, h: targetH } = dimsForResolution(resolution);

  // ----- Step 1: style anchor + negative -----
  await ctx.log.beginStep("style_anchor", "LLM style anchor + negative prompt");
  const { styleAnchor, negativePrompt } = await generateVeoStyle(ctx, { theme });
  await ctx.log.endStep({ styleAnchor, negativePrompt });

  // ----- Step 2: Veo prompt authoring -----
  await ctx.log.beginStep("veo_prompt", "LLM Veo prompt authoring", { singlePromptScenes });
  const voiceLabel = humanizeVoiceId(voiceId);
  const voiceTone = `${voiceLabel} voice character; ${emotion} emotional delivery for pacing, emphasis, and phrasing.`;
  const voBlock = `AUDIO / VOICEOVER (mandatory for Veo): The clip must have clear, intelligible English voiceover on the main soundtrack — not ambience-only, not music-only, and not sound-effects drowning the voice. In the Veo prompt you write, include (1) the exact narration as short quoted lines the voice must speak, sized to roughly ${duration} seconds of speech, (2) explicit mix direction: voiceover upfront and dry, ambience and SFX low under the voice, (3) forbid silent film, "no dialogue", or SFX-only mixes, and (4) explicit narrator casting matching the user's choices: voice preset "${voiceId}" (${voiceLabel}) and emotion "${emotion}" — describe how that voice sounds and how ${emotion} shows up in delivery (pace, warmth, intensity), woven into the Veo prompt so the generated speech reflects those settings.`;
  let promptInstruction: string;
  if (singlePromptScenes === 1) {
    promptInstruction = `Write a single cohesive prompt string for Google's Veo for a faceless vertical video (9:16). Max duration is ${duration} seconds.

${voBlock}

Then describe visuals, atmosphere, and pacing as one continuous scene. Narrator tone: ${voiceTone}. Avoid visually: ${negativePrompt}. End the prompt with this style anchor copied verbatim (comma-separated descriptors): ${styleAnchor}. Return ONLY the prompt string, nothing else.`;
  } else {
    promptInstruction = `Write ONE cohesive prompt string for Google's Veo for a faceless vertical video (9:16), max ${duration} seconds total. Still one Veo generation, but the user chose TWO scenes in one prompt — you must output BOTH scenes in full, not a one-scene-only description.

STRUCTURE (mandatory — do not skip):
- Start with a line **Scene 1 —** then fully describe Scene 1: distinct visuals, camera, atmosphere, pacing, and quoted voiceover lines for that scene (aim ~half the clip).
- Then a line **Scene 2 —** then fully describe Scene 2 with the same depth as Scene 1 (second ~half of the clip). Scene 2 must be a real second segment, not a vague coda or single closing sentence.
- Between the two labeled sections, explicitly describe the camera cut, time jump, or editorial transition into Scene 2.

${voBlock}

Split quoted narration across the two scenes; voiceover must remain clear through both. Narrator tone: ${voiceTone}. Avoid visually: ${negativePrompt}. End the entire prompt with this style anchor verbatim: ${styleAnchor}. Return ONLY the prompt string, nothing else.`;
  }

  const systemInstructionSingle =
    singlePromptScenes === 2
      ? "You write prompts for Google's Veo video model. When the user chose two scenes in one prompt, your plain-text output MUST include the literal labels **Scene 1 —** and **Scene 2 —** and fully develop both; never return only Scene 1 or an implied second half without a labeled Scene 2 section. Force clear foreground English voiceover (quoted lines + mix notes); the narrator must reflect the user's voice preset and emotion. Never imply SFX-only or silent video. Output plain text only — no JSON, no markdown fences."
      : "You write prompts for Google's Veo video model. Single-mode outputs must always force clear foreground English voiceover (quoted lines + mix notes); the narrator must reflect the user's voice preset and emotion settings given in the prompt. Never imply SFX-only or silent video. Output plain text only — no JSON, no markdown fences.";

  const veoPromptOut = await runWithRetry(
    ctx.replicate,
    ctx.refs.llmRef,
    {
      input: {
        prompt: `Theme: ${theme}

User-selected narrator voice preset: ${voiceId} (${voiceLabel}).
User-selected emotion for spoken delivery: ${emotion}.

${promptInstruction}`,
        system_instruction: systemInstructionSingle,
        max_output_tokens: singlePromptScenes === 2 ? 1600 : 1200,
        temperature: 0.75,
        thinking_budget: 0,
      },
    },
    10,
    ctx.recorder
  );
  let veoPrompt = Array.isArray(veoPromptOut)
    ? veoPromptOut.join("").trim()
    : String(veoPromptOut).trim();
  veoPrompt = veoPrompt.replace(/^["']|["']$/g, "").replace(/^```[\s\S]*?```/m, "").trim();
  if (!veoPrompt.toLowerCase().includes(styleAnchor.toLowerCase().slice(0, 24))) {
    veoPrompt = `${veoPrompt.replace(/[.,\s]+$/, "")}, ${styleAnchor}`;
  }
  await ctx.log.endStep({ promptChars: veoPrompt.length });

  // ----- Step 3: Veo single-clip generation -----
  await ctx.log.beginStep("video_generation", "Veo single-clip generation");
  if (await ctx.isCancelled()) throw new ReplicateCancellationError();
  const veoRes = await runWithRetry(
    ctx.replicate,
    ctx.refs.videoRef,
    { input: { prompt: veoPrompt, aspect_ratio: "9:16", duration, resolution } },
    10,
    ctx.recorder
  );
  if (await ctx.isCancelled()) throw new ReplicateCancellationError();
  const veoVideoUrl = extractMediaUrl(veoRes);
  if (!veoVideoUrl.startsWith("http")) {
    throw new Error("Veo did not return a valid video URL.");
  }
  await ctx.log.endStep({ veoVideoUrl });

  // ----- Step 4: extract audio (Veo provides native audio) -----
  await ctx.log.beginStep("audio_extraction", "Rendi extract audio track from Veo clip");
  let audioMp3Url: string;
  try {
    audioMp3Url = await extractVeoAudio(veoVideoUrl);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(
      `Could not extract audio from the generated Veo video (required for captions). ${msg} If the file has no audio track, try a different theme or prompt.`
    );
  }
  await ctx.log.endStep({ audioMp3Url });

  // ----- Step 5: Whisper transcription -----
  await ctx.log.beginStep("whisper_transcription", "Whisper word-level transcription");
  const wRes = await runWithRetry(
    ctx.replicate,
    ctx.refs.whisperRef,
    { input: { audio: audioMp3Url, language: "english", timestamp: "word", batch_size: 64 } },
    10,
    ctx.recorder
  );
  const whisperWords = parseWhisperWords(wRes);
  if (whisperWords.length === 0) {
    throw new Error("Whisper returned no word timestamps.");
  }
  await ctx.log.endStep({ wordCount: whisperWords.length });

  // ----- Step 6: ASS subtitles + burn-in (audio is native to the Veo clip) -----
  const audioSpeedFactor = 1;
  const finalDuration = duration;
  await ctx.log.beginStep("subtitle_burn", "ASS subtitles + Rendi burn-in");
  const assContent = buildAssContent(
    style,
    targetW,
    targetH,
    whisperWords,
    audioSpeedFactor,
    finalDuration
  );
  const { srtFilename, srtUrl } = await uploadAssCaptions(
    ctx.userId,
    assContent,
    `captions_veo_${Date.now()}.ass`
  );
  const rendiFinalUrl = await burnSubtitles(veoVideoUrl, srtUrl);
  await ctx.log.endStep({ rendiFinalUrl });

  // ----- Step 7: download + upload final MP4 -----
  await ctx.log.beginStep("storage_upload", "Download final MP4 + upload to Supabase");
  const { storagePath, publicUrl } = await downloadAndStoreFinal(
    ctx.userId,
    "reelscreator",
    rendiFinalUrl,
    `video_${Date.now()}.mp4`
  );
  await cleanupCaptions(srtFilename);
  await ctx.log.endStep({ storagePath, publicUrl });

  return {
    videoUrl: publicUrl,
    storagePath,
    width: targetW,
    height: targetH,
    durationSec: finalDuration,
    narration: whisperWords.map((w) => w.text).join(" "),
    scenePrompts: [veoPrompt],
  };
}

export async function runVeoPerScenePipeline(
  ctx: ReelsPipelineContext,
  params: VeoPerScenePipelineParams
): Promise<ReelsPipelineResult> {
  const { theme, duration, resolution, voiceId, emotion, sceneCount, style } = params;
  const { w: targetW, h: targetH } = dimsForResolution(resolution);
  const SCENE_COUNT = sceneCount;
  const DURATION = duration;
  const TOTAL_DURATION = SCENE_COUNT * DURATION;
  const MAX_WORDS_PER_SCENE = Math.max(6, Math.floor(DURATION * 1.7));

  // ----- Step 1: style anchor + negative -----
  await ctx.log.beginStep("style_anchor", "LLM style anchor + negative prompt");
  const { styleAnchor, negativePrompt: _negativePrompt } = await generateVeoStyle(ctx, {
    theme,
  });
  await ctx.log.endStep({ styleAnchor, negativePrompt: _negativePrompt });

  // ----- Step 2: scene breakdown -----
  const systemPrompt = `You are a video producer. Return a JSON array of exactly ${SCENE_COUNT} scene(s) for a faceless vertical video (9:16). Each scene is exactly ${DURATION} seconds.
All scenes share one visual world.

STYLE ANCHOR (append verbatim at the end of every video_prompt):
"${styleAnchor}"

NARRATION RULES:
- Narrations will be JOINED with spaces and spoken as ONE continuous TTS line.
- Flow as one story; use connective phrases between scenes.
- Each narration max ${MAX_WORDS_PER_SCENE} words. Spell digits as words.

Each scene object:
- "scene_id": number
- "video_prompt": string (must end with the STYLE ANCHOR string above, copied exactly)
- "narration": string

Return ONLY raw JSON array, nothing else.`;
  await ctx.log.beginStep("scene_breakdown", "LLM scene breakdown", {
    sceneCount: SCENE_COUNT,
    maxWordsPerScene: MAX_WORDS_PER_SCENE,
  });
  const scenes = await generateScenes(ctx, {
    theme,
    sceneCount: SCENE_COUNT,
    systemPrompt,
    styleAnchor,
    maxWordsPerScene: MAX_WORDS_PER_SCENE,
  });
  const fullNarration = scenes
    .map((s) => String(s.narration || "").trim())
    .filter(Boolean)
    .join(" ");
  if (!fullNarration) throw new Error("All scene narrations are empty.");
  await ctx.log.endStep({ scenes: scenes.length });

  // ----- Step 3: parallel Veo scene videos concurrent with the TTS pipeline -----
  if (await ctx.isCancelled()) throw new ReplicateCancellationError();
  const videoPromises = scenes.map((scene) =>
    runWithRetry(
      ctx.replicate,
      ctx.refs.videoRef,
      { input: { prompt: scene.video_prompt, aspect_ratio: "9:16", duration: DURATION, resolution } },
      10,
      ctx.recorder
    )
  );
  await ctx.log.beginStep(
    "video_generation",
    "Parallel Veo scene videos (with concurrent TTS pipeline)",
    { scenes: SCENE_COUNT, perSceneDuration: DURATION, resolution }
  );
  const [videoResponses, ttsPack] = await Promise.all([
    Promise.all(videoPromises),
    runTtsPipeline(ctx, {
      fullNarration,
      voiceId,
      emotion,
      totalDuration: TOTAL_DURATION,
      initialSpeed: 0.95,
    }),
  ]);
  if (await ctx.isCancelled()) throw new ReplicateCancellationError();
  const fullAudioUrl = ttsPack.audioUrl;
  const whisperWords = ttsPack.words;
  const audioEndTotal = ttsPack.audioEndTotal;
  const audioSpeedFactor = ttsPack.audioSpeedFactor;
  await ctx.log.endStep({ scenes: videoResponses.length });

  await ctx.log.beginStep(
    "tts_generation",
    "MiniMax TTS voiceover (ran concurrently with video)",
    { voiceId, emotion }
  );
  await ctx.log.endStep({ audioSpeedFactor });
  await ctx.log.beginStep(
    "whisper_transcription",
    "Whisper word-level transcription (ran concurrently with video)"
  );
  await ctx.log.endStep({ wordCount: whisperWords.length, measuredDuration: audioEndTotal });

  const finalDuration = TOTAL_DURATION;
  const perSceneDurStr = DURATION.toFixed(3);

  // Distribute the continuous TTS timeline across scenes proportionally to each
  // scene's narration length, then remap onto the concatenated video timeline.
  const lens = scenes.map((s) => Math.max(1, String(s.narration || "").length));
  const charTotal = lens.reduce((a, b) => a + b, 0);
  const sceneRanges: { start: number; end: number; index: number }[] = [];
  let acc = 0;
  for (let i = 0; i < scenes.length; i++) {
    const span = (lens[i] / charTotal) * audioEndTotal;
    sceneRanges.push({ start: acc, end: acc + span, index: i });
    acc += span;
  }
  const videoWords = mapWhisperToPerSceneVideoTimeline(
    whisperWords,
    sceneRanges,
    DURATION,
    audioEndTotal,
    audioSpeedFactor,
    finalDuration
  );
  const assContent = buildAssContent(style, targetW, targetH, videoWords, 1, finalDuration);

  // ----- Step 4: ASS subtitles + Rendi concat/merge/burn -----
  await ctx.log.beginStep("rendi_render", "ASS subtitles + Rendi concat/merge/burn-in");
  const { srtFilename, srtUrl } = await uploadAssCaptions(
    ctx.userId,
    assContent,
    `captions_veo_${Date.now()}.ass`
  );
  const sceneVideoUrls = videoResponses.map((res, i) => {
    const url = extractMediaUrl(res);
    if (!url.startsWith("http")) {
      throw new Error(`Failed to get video URL for scene ${scenes[i].scene_id}`);
    }
    return url;
  });
  const combinedVideoUrl = await concatScenes(sceneVideoUrls, perSceneDurStr, targetW, targetH);
  const fontUrl = getFontUrl(style.fontname);
  const mergedVideoUrl = await mergeVideoAudioSubs({
    combinedVideoUrl,
    fullAudioUrl,
    srtUrl,
    fontUrl,
    audioSpeedFactor,
    finalDuration,
    shortest: true,
  });
  const rendiFinalUrl = await burnSubtitles(mergedVideoUrl, srtUrl);
  await ctx.log.endStep({ combinedVideoUrl, mergedVideoUrl, rendiFinalUrl });

  // ----- Step 5: download + upload final MP4 -----
  await ctx.log.beginStep("storage_upload", "Download final MP4 + upload to Supabase");
  const { storagePath, publicUrl } = await downloadAndStoreFinal(
    ctx.userId,
    "reelscreator",
    rendiFinalUrl,
    `video_${Date.now()}.mp4`
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
