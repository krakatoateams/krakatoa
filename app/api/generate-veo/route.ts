/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * =============================================================================
 * SPIKE: google/veo-3.1-lite (Replicate OpenAPI, models API, 2026)
 * =============================================================================
 * Source: GET https://api.replicate.com/v1/models/google/veo-3.1-lite
 *   → latest_version.openapi_schema.components.schemas.Input
 *
 * Required input:  prompt (string)
 * Optional inputs: seed (int), image (uri), duration (enum 4 | 6 | 8, default 8),
 *   last_frame (uri), resolution (enum "720p" | "1080p", default 720p),
 *   aspect_ratio (enum "16:9" | "9:16", default 16:9)
 * negative_prompt: NOT in OpenAPI — fold visual negatives into the text prompt only.
 * Output schema: string URI (video URL).
 * 1080p: schema text requires duration === 8 seconds (enforced in this route).
 * Audio: README claims native audio; MVP still hard-fails if Rendi cannot extract
 *   an audio stream from the returned MP4 (no TTS fallback).
 * =============================================================================
 */
import { NextResponse } from "next/server";
import Replicate from "replicate";
import { insertUserCreation } from "@/lib/creations-db";
import { supabase } from "@/lib/supabase";
import { STORAGE_BUCKET, videosStoragePath, videosTempStoragePath } from "@/lib/storage-buckets";
import { extractJson, hexToAssColor, formatAssTime, runWithRetry } from "@/lib/reels-helpers";
import { extractMediaUrl } from "@/lib/replicate-utils";
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
import { estimateVeoCredits } from "@/lib/credit-costs";
import { recordUsageEvent } from "@/lib/usage-events-db";

// Vercel Hobby plan caps serverless functions at 300s (Pro allows up to 800s)
export const maxDuration = 300;

const LLM_MODEL = "google/gemini-2.5-flash";
const VEO_MODEL = "google/veo-3.1-lite";
const WHISPER_MODEL =
  "vaibhavs10/incredibly-fast-whisper:3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c";
const MINIMAX_MODEL = "minimax/speech-02-turbo";

const MINIMAX_EMOTIONS = [
  "happy",
  "sad",
  "angry",
  "fearful",
  "disgusted",
  "surprised",
  "calm",
  "fluent",
  "neutral",
] as const;

type WordChunk = { text: string; start: number; end: number };

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

function parseWhisperWords(wRes: any): WordChunk[] {
  const words: WordChunk[] = [];
  if (wRes?.chunks) {
    for (const c of wRes.chunks) {
      const txt = String(c.text || "").trim();
      if (!txt) continue;
      words.push({
        text: txt,
        start: c.timestamp?.[0] ?? 0,
        end: c.timestamp?.[1] ?? (c.timestamp?.[0] ?? 0) + 0.3,
      });
    }
  } else if (wRes?.segments) {
    for (const seg of wRes.segments) {
      for (const w of seg.words || []) {
        const txt = String(w.word || w.text || "").trim();
        if (!txt) continue;
        words.push({
          text: txt,
          start: w.start ?? seg.start ?? 0,
          end: w.end ?? seg.end ?? (w.start ?? 0) + 0.3,
        });
      }
    }
  }
  return words;
}

function buildAssContent(
  style: {
    fontname: string;
    fontsize: number;
    primaryColor: string;
    highlightColor: string;
    outlineColor: string;
    outlineThickness: number;
    marginV: number;
  },
  playResX: number,
  playResY: number,
  words: WordChunk[],
  audioSpeedFactor: number,
  finalDuration: number
): string {
  const primaryColorASS = hexToAssColor(style.primaryColor);
  const outlineColorASS = hexToAssColor(style.outlineColor);
  const highlightColorASS = hexToAssColor(style.highlightColor);
  const maxMarginV = playResY - style.fontsize * 1.5;
  const actualMarginV = Math.floor((style.marginV / 100) * maxMarginV);

  let assContent = `[Script Info]
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${style.fontname},${style.fontsize},${primaryColorASS},&H000000FF,${outlineColorASS},&H00000000,-1,0,0,0,100,100,0,0,1,${style.outlineThickness},0,2,10,10,${actualMarginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  for (const w of words) {
    const text = w.text.trim();
    if (!text) continue;
    const start = w.start / audioSpeedFactor;
    const end = Math.min(w.end / audioSpeedFactor, finalDuration);
    if (start >= finalDuration) continue;
    const lineText = `{\\c${highlightColorASS}}{\\b1}${text.toUpperCase()}{\\b0}`;
    assContent += `Dialogue: 0,${formatAssTime(start)},${formatAssTime(end)},Default,,0,0,0,,${lineText}\n`;
  }

  if (!assContent.includes("Dialogue:")) {
    assContent += `Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,(No speech detected)\n`;
  }
  return assContent;
}

/** Map Whisper timestamps (on continuous TTS) to concatenated video timeline; apply atempo once here. */
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

export async function POST(req: Request) {
  // Platform-observability trackers — declared before the try so the catch block
  // and any post-job-creation early-return path can finalize them.
  let profileId: string | null = null;
  let jobId: string | null = null;
  let currentStepId: string | null = null;
  let videoAssetId: string | null = null;
  // Credit-spend trackers — see app/api/generate/route.ts for the same pattern.
  let creditsSpent = false;
  let creditsAmount = 0;
  let creditJobKind: "veo_single" | "veo_perscene" | null = null;

  const safe = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (e) {
      console.warn(`[veo obs] ${label} failed:`, e);
      return null;
    }
  };

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

  try {
    // STRICT profile resolution — this route now charges credits. See
    // app/api/generate/route.ts for the full rationale; in short, free
    // generation is unacceptable for a route that costs credits, so any
    // non-auth profile failure now becomes a 500 instead of a silent fallback.
    //   profile.id      -> platform tables (jobs / job_steps / assets) + credits
    //   profile.user_id -> legacy user_creations dual-write (= users.id)
    let userId: string | null = null;
    try {
      const profile = await requireCurrentProfile();
      profileId = profile.id;
      userId = profile.user_id;
    } catch (e) {
      if (e instanceof Error && /not authenticated/i.test(e.message)) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
      console.error("[veo] profile resolution failed (non-auth):", e);
      return NextResponse.json(
        { error: "Profile resolution failed. Please try again." },
        { status: 500 }
      );
    }

    const body = await req.json();
    const theme = String(body.theme || "").trim();
    if (!theme) {
      return NextResponse.json({ error: "Theme is required" }, { status: 400 });
    }

    const emotionRaw = String(body.emotion || "").toLowerCase().trim();
    if (emotionRaw === "auto" || !MINIMAX_EMOTIONS.includes(emotionRaw as (typeof MINIMAX_EMOTIONS)[number])) {
      return NextResponse.json(
        {
          error:
            'Invalid emotion: server expects an explicit MiniMax emotion (not "auto"). Resolve "auto" on the client before calling this API.',
        },
        { status: 400 }
      );
    }
    const emotion = emotionRaw as (typeof MINIMAX_EMOTIONS)[number];

    const voiceId: string = body.voiceId || "English_CaptivatingStoryteller";
    const modeStr = String(body.mode || "").trim();
    const isSingle = modeStr.toLowerCase() === "single";
    const isPerScene = modeStr === "perScene" || modeStr.toLowerCase() === "perscene";
    if (!isSingle && !isPerScene) {
      return NextResponse.json({ error: 'mode must be "single" or "perScene"' }, { status: 400 });
    }

    const duration = Number(body.duration);
    if (![4, 6, 8].includes(duration)) {
      return NextResponse.json({ error: "duration must be 4, 6, or 8" }, { status: 400 });
    }
    // Semantics: in perScene mode, `duration` is seconds per scene (stitched total ≈ numScenes * duration).
    // In single mode, it is the one-clip length for the single Veo call.

    const resolution = String(body.resolution || "");
    if (resolution !== "720p" && resolution !== "1080p") {
      return NextResponse.json({ error: 'resolution must be "720p" or "1080p"' }, { status: 400 });
    }
    if (resolution === "1080p" && duration !== 8) {
      return NextResponse.json(
        { error: "1080p requires 8 second duration (Veo 3.1 Lite API constraint)." },
        { status: 400 }
      );
    }

    const style = body.captionStyle || {
      fontname: "Arial",
      fontsize: 28,
      primaryColor: "#FFFFFF",
      highlightColor: "#FFFF00",
      outlineColor: "#000000",
      outlineThickness: 4,
      marginV: 15,
      highlightOnly: false,
    };

    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
    const rendiApiKey = process.env.RENDI_API_KEY;
    if (!rendiApiKey) {
      throw new Error("RENDI_API_KEY is not set.");
    }

    const runRendiSingle = async (
      ffmpegCommand: string,
      inputFiles: Record<string, string>,
      outputFiles: Record<string, string>
    ) => {
      const resp = await fetch("https://api.rendi.dev/v1/run-ffmpeg-command", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-KEY": rendiApiKey },
        body: JSON.stringify({
          ffmpeg_command: ffmpegCommand,
          input_files: inputFiles,
          output_files: outputFiles,
        }),
      });
      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(`Rendi API failed (${resp.status}): ${errText || resp.statusText}`);
      }
      const { command_id } = await resp.json();
      let attempts = 0;
      while (attempts < 120) {
        await new Promise((r) => setTimeout(r, 3000));
        const poll = await fetch(`https://api.rendi.dev/v1/commands/${command_id}`, {
          headers: { "X-API-KEY": rendiApiKey },
        });
        if (poll.ok) {
          const data = await poll.json();
          const status = (data.status || "").toUpperCase();
          if (status === "SUCCESS" || status === "COMPLETED") return data;
          if (status === "FAILED" || status === "ERROR") {
            throw new Error(`Rendi failed: ${JSON.stringify(data.error_message || data.error_status || data)}`);
          }
        }
        attempts++;
      }
      throw new Error("Rendi polling timed out.");
    };

    const getRendiUrl = (pollData: any, alias: string): string => {
      const url = pollData.output_files?.[alias]?.storage_url;
      if (!url) throw new Error(`Rendi output "${alias}" URL not found.`);
      return url;
    };

    const FONTS_REF = "ca9288e18a";
    const fontUrls: Record<string, string> = {
      Poppins: `https://cdn.jsdelivr.net/gh/google/fonts@${FONTS_REF}/ofl/poppins/Poppins-ExtraBold.ttf`,
      Montserrat: `https://cdn.jsdelivr.net/gh/google/fonts@${FONTS_REF}/ofl/montserrat/Montserrat-Bold.ttf`,
      Bangers: `https://cdn.jsdelivr.net/gh/google/fonts@${FONTS_REF}/ofl/bangers/Bangers-Regular.ttf`,
    };
    const fontUrl = fontUrls[style.fontname];

    // ---- Hoisted mode-specific inputs ----
    // Single mode: validate singlePromptScenes up front so an insufficient-
    // credit return never goes through a half-validated request.
    // PerScene mode: compute SCENE_COUNT up front so credit cost can be
    // calculated before the job (and any provider call) is created.
    let singlePromptScenes = 0;
    let SCENE_COUNT = 0;
    if (isSingle) {
      singlePromptScenes = Number(body.singlePromptScenes);
      if (![1, 2].includes(singlePromptScenes)) {
        return NextResponse.json(
          { error: "singlePromptScenes must be 1 or 2 in single mode" },
          { status: 400 }
        );
      }
    } else {
      SCENE_COUNT = Math.min(3, Math.max(1, Number(body.numScenes) || 1));
    }

    creditJobKind = isSingle ? "veo_single" : "veo_perscene";
    const totalCreditDurationSec = isSingle ? duration : SCENE_COUNT * duration;
    const requiredCredits = estimateVeoCredits({ durationSec: totalCreditDurationSec });

    // ---- Platform job (best-effort observability) ----
    // Asset creation is intentionally deferred until AFTER the credit spend
    // succeeds, so the assets table never carries a processing row for a
    // request that was rejected for insufficient credits.
    const job = await safe("createJob", () => createJob({
      profileId: profileId!,
      tool: "veo",
      jobType: creditJobKind!,
      provider: "replicate",
      model: VEO_MODEL,
      input: {
        theme: theme.slice(0, 500),
        mode: isSingle ? "single" : "perScene",
        duration,
        resolution,
        voiceId,
        emotion,
        ...(isSingle ? { singlePromptScenes } : { numScenes: SCENE_COUNT }),
      },
    }));
    if (job) {
      jobId = job.id;
      await safe("startJob", () => startJob(profileId!, jobId!));
    }

    // ---- Credit spend (BUSINESS LOGIC — not safe-wrapped) ----
    // Insufficient → 402, no provider call, no processing asset. Other infra
    // failures bubble to the outer catch as a 500. jobId-based idempotency
    // prevents in-flight retry double-charges; full HTTP retries with a fresh
    // jobId remain an accepted limitation of this dummy phase.
    try {
      await spendCredits({
        profileId: profileId!,
        amount: requiredCredits,
        idempotencyKey: jobId
          ? `spend:${creditJobKind}:${jobId}`
          : `spend:${creditJobKind}:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: isSingle
          ? "Veo single-clip generation"
          : "Veo per-scene generation",
        metadata: {
          tool: "veo",
          jobType: creditJobKind,
          mode: isSingle ? "single" : "perScene",
          duration,
          ...(isSingle ? { singlePromptScenes } : { sceneCount: SCENE_COUNT }),
          totalDuration: totalCreditDurationSec,
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
      tool: "veo",
      assetType: "video",
      role: "final_video",
      provider: "replicate",
      model: VEO_MODEL,
      metadata: { theme: theme.slice(0, 200), mode: isSingle ? "single" : "perScene" },
    }));
    if (asset) videoAssetId = asset.id;

    // ----- Step 1: style anchor + negative (Gemini, thinking_budget 0) -----
    await beginStep("style_anchor", "LLM style anchor + negative prompt");
    const styleSystemPrompt = `You are a cinematographer. Given a video theme, return a JSON object with exactly two fields:
- style_anchor: comma-separated string of 6-8 visual descriptors (always include photorealistic and 9:16 vertical)
- negative_prompt: comma-separated list of visual things to avoid
Return ONLY raw JSON, nothing else.`;

    const styleLlmOutput = await runWithRetry(replicate, LLM_MODEL, {
      input: {
        prompt: theme,
        system_instruction: styleSystemPrompt,
        max_output_tokens: 512,
        temperature: 0.7,
        thinking_budget: 0,
      },
    });
    const styleRaw = Array.isArray(styleLlmOutput) ? styleLlmOutput.join("") : String(styleLlmOutput);
    let styleAnchor = "photorealistic, highly detailed, cinematic lighting, 9:16 vertical";
    let negativePrompt = "blurry, low quality, distorted, watermark";
    try {
      const styleData = extractJson(styleRaw) as Record<string, unknown>;
      styleAnchor = String(styleData.style_anchor || styleAnchor);
      negativePrompt = String(styleData.negative_prompt || negativePrompt);
    } catch {
      console.warn("[Veo] Style JSON parse failed, using defaults");
    }
    await endStep({ styleAnchor, negativePrompt });

    const { w: targetW, h: targetH } = dimsForResolution(resolution as "720p" | "1080p");

    if (isSingle) {
      // singlePromptScenes was validated up front (before credit spend).
      await beginStep("veo_prompt", "LLM Veo prompt authoring", { singlePromptScenes });
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

      const veoPromptOut = await runWithRetry(replicate, LLM_MODEL, {
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
      });
      let veoPrompt = Array.isArray(veoPromptOut) ? veoPromptOut.join("").trim() : String(veoPromptOut).trim();
      veoPrompt = veoPrompt.replace(/^["']|["']$/g, "").replace(/^```[\s\S]*?```/m, "").trim();
      if (!veoPrompt.toLowerCase().includes(styleAnchor.toLowerCase().slice(0, 24))) {
        veoPrompt = `${veoPrompt.replace(/[.,\s]+$/, "")}, ${styleAnchor}`;
      }
      await endStep({ promptChars: veoPrompt.length });

      await beginStep("video_generation", "Veo single-clip generation");
      const veoRes = await runWithRetry(replicate, VEO_MODEL, {
        input: {
          prompt: veoPrompt,
          aspect_ratio: "9:16",
          duration,
          resolution,
        },
      });
      const veoVideoUrl = extractMediaUrl(veoRes);
      if (!veoVideoUrl.startsWith("http")) {
        throw new Error("Veo did not return a valid video URL.");
      }
      await endStep({ veoVideoUrl });

      await beginStep("audio_extraction", "Rendi extract audio track from Veo clip");
      let audioMp3Url: string;
      try {
        const extractResult = await runRendiSingle(
          `-i {{in_video}} -vn -map 0:a:0 -acodec libmp3lame -q:a 2 {{out_a}}`,
          { in_video: veoVideoUrl },
          { out_a: "audio.mp3" }
        );
        audioMp3Url = getRendiUrl(extractResult, "out_a");
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(
          `Could not extract audio from the generated Veo video (required for captions). ${msg} If the file has no audio track, try a different theme or prompt.`
        );
      }
      await endStep({ audioMp3Url });

      await beginStep("whisper_transcription", "Whisper word-level transcription");
      const wRes = (await runWithRetry(replicate, WHISPER_MODEL, {
        input: { audio: audioMp3Url, language: "english", timestamp: "word", batch_size: 64 },
      })) as any;
      const whisperWords = parseWhisperWords(wRes);
      if (whisperWords.length === 0) {
        throw new Error("Whisper returned no word timestamps.");
      }
      await endStep({ wordCount: whisperWords.length });

      const audioSpeedFactor = 1;
      const finalDuration = duration;
      await beginStep("subtitle_burn", "ASS subtitles + Rendi burn-in");
      const assContent = buildAssContent(style, targetW, targetH, whisperWords, audioSpeedFactor, finalDuration);

      const srtFilename = videosTempStoragePath(`captions_veo_${Date.now()}.ass`);
      const { error: uploadError } = await supabase.storage.from(STORAGE_BUCKET).upload(srtFilename, assContent, {
        contentType: "text/plain",
        cacheControl: "3600",
        upsert: false,
      });
      if (uploadError) throw new Error(`Failed to upload captions: ${uploadError.message}`);
      const { data: srtPub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(srtFilename);
      const srtUrl = srtPub.publicUrl;

      const burnResult = await runRendiSingle(
        `-i {{in_video}} -i {{in_srt}} -vf "subtitles={{in_srt}}" -map 0:v:0 -map 0:a:0? -c:v libx264 -crf 20 -c:a copy {{out_final}}`,
        { in_video: veoVideoUrl, in_srt: srtUrl },
        { out_final: "final_video.mp4" }
      );
      const rendiFinalUrl = getRendiUrl(burnResult, "out_final");
      await endStep({ rendiFinalUrl });

      await beginStep("storage_upload", "Download final MP4 + upload to Supabase");
      const videoResponse = await fetch(rendiFinalUrl);
      if (!videoResponse.ok) throw new Error(`Failed to download final video: ${videoResponse.statusText}`);
      const buf = await videoResponse.arrayBuffer();
      const finalFilename = videosStoragePath(`reels_veo_${Date.now()}.mp4`);
      const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(finalFilename, buf, {
        contentType: "video/mp4",
        cacheControl: "3600",
        upsert: false,
      });
      if (upErr) throw new Error(`Failed to upload final video: ${upErr.message}`);
      const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(finalFilename);
      try {
        await supabase.storage.from(STORAGE_BUCKET).remove([srtFilename]);
      } catch {
        /* non-fatal */
      }
      await endStep({ storagePath: finalFilename, publicUrl: pub.publicUrl });

      // Platform: mark asset ready + finish job. Single mode intentionally keeps
      // its legacy behavior — NO user_creations write and response stays { videoUrl }.
      // `costCredits` on both calls is a display snapshot only — the ledger row
      // created by spendCredits above is the billing source of truth.
      if (videoAssetId && profileId) {
        await safe("markAssetReady", () => markAssetReady(profileId!, videoAssetId!, {
          storagePath: finalFilename,
          publicUrl: pub.publicUrl,
          mimeType: "video/mp4",
          durationSec: finalDuration,
          width: targetW,
          height: targetH,
          costCredits: creditsAmount,
          metadata: { mode: "single", duration, resolution, voiceId, emotion },
        }));
      }
      if (jobId && profileId) {
        await safe("finishJob", () => finishJob(profileId!, jobId!, {
          output: { videoUrl: pub.publicUrl, storagePath: finalFilename, assetId: videoAssetId },
          costCredits: creditsAmount,
        }));
      }

      // Usage event — analytics only, NEVER affects billing/response.
      await safe("recordUsage", () => recordUsageEvent({
        profileId: profileId!,
        jobId: jobId ?? null,
        assetId: videoAssetId ?? null,
        tool: "veo",
        provider: "replicate",
        model: VEO_MODEL,
        unitType: "video_seconds",
        units: finalDuration,
        creditsCharged: creditsAmount,
        metadata: { jobType: "veo_single", duration, resolution, singlePromptScenes },
      }));

      return NextResponse.json({ videoUrl: pub.publicUrl });
    }

    // ----- Per Scene mode -----
    // SCENE_COUNT was hoisted up so credit spend could happen before any
    // provider call. Keep the local aliases below to avoid touching the rest
    // of the per-scene pipeline.
    const DURATION = duration;
    const TOTAL_DURATION = SCENE_COUNT * DURATION;
    const MAX_WORDS_PER_SCENE = Math.max(6, Math.floor(DURATION * 1.7));

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

    await beginStep("scene_breakdown", "LLM scene breakdown", { sceneCount: SCENE_COUNT, maxWordsPerScene: MAX_WORDS_PER_SCENE });
    let scenes: any[] = [];
    let lastRaw = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      const llmOutput = await runWithRetry(replicate, LLM_MODEL, {
        input: {
          prompt: theme,
          system_instruction: systemPrompt,
          max_output_tokens: 1500,
          temperature: 0.8,
          dynamic_thinking: true,
        },
      });
      lastRaw = Array.isArray(llmOutput) ? llmOutput.join("") : String(llmOutput);
      try {
        const parsed = extractJson(lastRaw) as any;
        const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.scenes) ? parsed.scenes : null;
        if (Array.isArray(arr) && arr.length === SCENE_COUNT) {
          scenes = arr;
          break;
        }
        console.warn(`[Veo perScene attempt ${attempt}] expected ${SCENE_COUNT} scenes`);
      } catch {
        console.warn(`[Veo perScene attempt ${attempt}] parse fail`);
      }
    }
    if (!Array.isArray(scenes) || scenes.length !== SCENE_COUNT) {
      throw new Error(`LLM did not return exactly ${SCENE_COUNT} scene(s) after 3 attempts.`);
    }

    for (const scene of scenes) {
      let p = String(scene.video_prompt || "").trim();
      p = p.replace(/[,.\s]*and\s+the\s+style\s+anchor\.?\s*$/i, "");
      p = p.replace(/[,.\s]*the\s+style\s+anchor\.?\s*$/i, "");
      if (!p.toLowerCase().includes(styleAnchor.toLowerCase().slice(0, 20))) {
        p = `${p.replace(/[.,\s]+$/, "")}, ${styleAnchor}`;
      }
      scene.video_prompt = p;
      const nw = String(scene.narration || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      scene.narration = nw.slice(0, MAX_WORDS_PER_SCENE).join(" ");
    }

    const fullNarration = scenes.map((s) => String(s.narration || "").trim()).filter(Boolean).join(" ");
    if (!fullNarration) throw new Error("All scene narrations are empty.");
    await endStep({ scenes: scenes.length });

    const generateTtsAndTranscribe = async (text: string, speed: number) => {
      const ttsRes = await runWithRetry(replicate, MINIMAX_MODEL, {
        input: {
          text,
          voice_id: voiceId,
          emotion,
          speed,
          pitch: 0,
          language_boost: "English",
          audio_format: "mp3",
          bitrate: 128000,
        },
      });
      const url = extractMediaUrl(ttsRes);
      if (!url.startsWith("http")) throw new Error("Failed to generate TTS audio.");
      const wRes = (await runWithRetry(replicate, WHISPER_MODEL, {
        input: { audio: url, language: "english", timestamp: "word", batch_size: 64 },
      })) as any;
      const words = parseWhisperWords(wRes);
      if (words.length === 0) throw new Error("Whisper returned no word timestamps.");
      const dur = words[words.length - 1].end;
      return { audioUrl: url, words, duration: dur };
    };

    const INITIAL_SPEED = 0.95;
    const runTtsPipeline = async () => {
      let { audioUrl, words, duration: audioEndTotal } = await generateTtsAndTranscribe(fullNarration, INITIAL_SPEED);
      const RATIO_LOW = 0.85;
      const RATIO_HIGH = 1.15;
      const firstRatio = audioEndTotal / TOTAL_DURATION;
      if (firstRatio < RATIO_LOW || firstRatio > RATIO_HIGH) {
        const corrected = Math.max(0.5, Math.min(2, INITIAL_SPEED * firstRatio));
        ({ audioUrl, words, duration: audioEndTotal } = await generateTtsAndTranscribe(fullNarration, corrected));
      }
      let audioSpeedFactor = 1;
      const finalRatio = audioEndTotal / TOTAL_DURATION;
      if (Math.abs(1 - finalRatio) > 0.01) {
        audioSpeedFactor = Math.max(0.5, Math.min(2, finalRatio));
      }
      return { audioUrl, words, audioEndTotal, audioSpeedFactor };
    };

    const videoPromises = scenes.map((scene: any) =>
      runWithRetry(replicate, VEO_MODEL, {
        input: {
          prompt: scene.video_prompt,
          aspect_ratio: "9:16",
          duration: DURATION,
          resolution,
        },
      })
    );
    // Veo scene videos and the TTS+Whisper pipeline run concurrently. We wrap the
    // wall-clock of the parallel block as a single video_generation step, then
    // record tts_generation + whisper_transcription sequentially (post-hoc) for
    // observability — without restructuring the generation pipeline.
    await beginStep("video_generation", "Parallel Veo scene videos (with concurrent TTS pipeline)", { scenes: SCENE_COUNT, perSceneDuration: DURATION, resolution });
    const [videoResponses, ttsPack] = await Promise.all([Promise.all(videoPromises), runTtsPipeline()]);
    const fullAudioUrl = ttsPack.audioUrl;
    const whisperWords = ttsPack.words;
    const audioEndTotal = ttsPack.audioEndTotal;
    const audioSpeedFactor = ttsPack.audioSpeedFactor;
    await endStep({ scenes: videoResponses.length });

    await beginStep("tts_generation", "MiniMax TTS voiceover (ran concurrently with video)", { voiceId, emotion });
    await endStep({ audioSpeedFactor });
    await beginStep("whisper_transcription", "Whisper word-level transcription (ran concurrently with video)");
    await endStep({ wordCount: whisperWords.length, measuredDuration: audioEndTotal });

    const finalDuration = TOTAL_DURATION;
    const perSceneDurStr = DURATION.toFixed(3);

    const lens = scenes.map((s) => Math.max(1, String(s.narration || "").length));
    const charTotal = lens.reduce((a: number, b: number) => a + b, 0);
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

    await beginStep("rendi_render", "ASS subtitles + Rendi concat/merge/burn-in");
    const srtFilename = videosTempStoragePath(`captions_veo_${Date.now()}.ass`);
    const { error: uploadAssErr } = await supabase.storage.from(STORAGE_BUCKET).upload(srtFilename, assContent, {
      contentType: "text/plain",
      cacheControl: "3600",
      upsert: false,
    });
    if (uploadAssErr) throw new Error(`Failed to upload captions: ${uploadAssErr.message}`);
    const { data: srtPub2 } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(srtFilename);
    const srtUrl = srtPub2.publicUrl;

    const sceneVideoUrls = videoResponses.map((res, i) => {
      const url = extractMediaUrl(res);
      if (!url.startsWith("http")) throw new Error(`Failed to get video URL for scene ${scenes[i].scene_id}`);
      return url;
    });

    const vInputFiles: Record<string, string> = {};
    sceneVideoUrls.forEach((url, i) => {
      vInputFiles[`in_v${i + 1}`] = url;
    });
    const vInputArgs = sceneVideoUrls.map((_, i) => `-i {{in_v${i + 1}}}`).join(" ");
    const normalizedStreams = sceneVideoUrls
      .map(
        (_, i) =>
          `[${i}:v]tpad=stop_mode=clone:stop_duration=2,trim=duration=${perSceneDurStr},setpts=PTS-STARTPTS,fps=30,scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v${i}]`
      )
      .join(";");
    const concatInputs = sceneVideoUrls.map((_, i) => `[v${i}]`).join("");

    let combinedVideoUrl: string;
    if (sceneVideoUrls.length === 1) {
      const r0 = await runRendiSingle(
        `${vInputArgs} -filter_complex "${normalizedStreams}" -map "[v0]" -c:v libx264 -crf 20 -pix_fmt yuv420p {{out_v}}`,
        vInputFiles,
        { out_v: "combined_video.mp4" }
      );
      combinedVideoUrl = getRendiUrl(r0, "out_v");
    } else {
      const r1 = await runRendiSingle(
        `${vInputArgs} -filter_complex "${normalizedStreams};${concatInputs}concat=n=${sceneVideoUrls.length}:v=1:a=0[v]" -map "[v]" -c:v libx264 -crf 20 -pix_fmt yuv420p {{out_v}}`,
        vInputFiles,
        { out_v: "combined_video.mp4" }
      );
      combinedVideoUrl = getRendiUrl(r1, "out_v");
    }

    let mergeCommand = `-i {{in_video}} -i {{in_audio}} -i {{in_srt}}`;
    const mergeInputs: Record<string, string> = { in_video: combinedVideoUrl, in_audio: fullAudioUrl, in_srt: srtUrl };
    if (fontUrl) {
      mergeCommand += ` -attach {{in_font}} -metadata:s:t:0 mimetype=application/x-truetype-font -metadata:s:t:0 filename="font.ttf"`;
      mergeInputs.in_font = fontUrl;
    }
    const atempoStage =
      Math.abs(audioSpeedFactor - 1) > 0.001 ? `atempo=${audioSpeedFactor.toFixed(4)},` : "";
    mergeCommand += ` -filter_complex "[1:a]apad,${atempoStage}atrim=duration=${finalDuration.toFixed(3)},asetpts=PTS-STARTPTS[a]"`;
    mergeCommand += ` -map 0:v:0 -map "[a]" -map 2:s:0 -c:v copy -c:a aac -c:s copy -shortest {{out_merged}}`;

    const mergeResult = await runRendiSingle(mergeCommand, mergeInputs, { out_merged: "merged.mkv" });
    const mergedVideoUrl = getRendiUrl(mergeResult, "out_merged");

    const burnResult = await runRendiSingle(
      `-i {{in_video}} -i {{in_srt}} -vf "subtitles={{in_srt}}" -map 0:v:0 -map 0:a:0? -c:v libx264 -crf 20 -c:a copy {{out_final}}`,
      { in_video: mergedVideoUrl, in_srt: srtUrl },
      { out_final: "final_video.mp4" }
    );
    const rendiFinalUrl = getRendiUrl(burnResult, "out_final");
    await endStep({ combinedVideoUrl, mergedVideoUrl, rendiFinalUrl });

    await beginStep("storage_upload", "Download final MP4 + upload to Supabase");
    const videoResponse = await fetch(rendiFinalUrl);
    if (!videoResponse.ok) throw new Error(`Failed to download final video: ${videoResponse.statusText}`);
    const buf = await videoResponse.arrayBuffer();
    const finalFilename = videosStoragePath(`reels_veo_${Date.now()}.mp4`);
    const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(finalFilename, buf, {
      contentType: "video/mp4",
      cacheControl: "3600",
      upsert: false,
    });
    if (upErr) throw new Error(`Failed to upload final video: ${upErr.message}`);
    const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(finalFilename);
    try {
      await supabase.storage.from(STORAGE_BUCKET).remove([srtFilename]);
    } catch {
      /* non-fatal */
    }
    await endStep({ storagePath: finalFilename, publicUrl: pub.publicUrl });

    // Platform: mark asset ready + finish job before the unchanged legacy write.
    // costCredits is a display snapshot — credit_transactions is the billing truth.
    if (videoAssetId && profileId) {
      await safe("markAssetReady", () => markAssetReady(profileId!, videoAssetId!, {
        storagePath: finalFilename,
        publicUrl: pub.publicUrl,
        mimeType: "video/mp4",
        durationSec: finalDuration,
        width: targetW,
        height: targetH,
        costCredits: creditsAmount,
        metadata: { mode: "perScene", duration, resolution, voiceId, emotion },
      }));
    }
    if (jobId && profileId) {
      await safe("finishJob", () => finishJob(profileId!, jobId!, {
        output: { videoUrl: pub.publicUrl, storagePath: finalFilename, assetId: videoAssetId },
        costCredits: creditsAmount,
      }));
    }

    // Usage event — analytics only, NEVER affects billing/response.
    await safe("recordUsage", () => recordUsageEvent({
      profileId: profileId!,
      jobId: jobId ?? null,
      assetId: videoAssetId ?? null,
      tool: "veo",
      provider: "replicate",
      model: VEO_MODEL,
      unitType: "video_seconds",
      units: TOTAL_DURATION,
      creditsCharged: creditsAmount,
      metadata: { jobType: "veo_perscene", duration, resolution, sceneCount: SCENE_COUNT },
    }));

    let historyItem;
    try {
      historyItem = await insertUserCreation({
        userId: userId as string,
        tool: "reels_veo",
        mediaType: "video",
        mediaUrl: pub.publicUrl,
        storagePath: finalFilename,
        title: theme.slice(0, 200),
        metadata: {
          mode: isSingle ? "single" : "perScene",
          duration,
          resolution,
          voiceId,
          emotion,
        },
      });
    } catch (historyErr) {
      console.warn("[Reels Veo] History log failed (video still saved):", historyErr);
    }

    return NextResponse.json({ videoUrl: pub.publicUrl, historyItem });
  } catch (error: unknown) {
    console.error("[generate-veo]", error);
    const message = error instanceof Error ? error.message : String(error);
    // Best-effort failure marking — must not throw or mask the original error.
    const errJson = { message };
    if (currentStepId && profileId) {
      await safe("failStep", () => failJobStep(profileId!, currentStepId!, errJson));
      currentStepId = null;
    }
    if (videoAssetId && profileId) {
      await safe("failAsset", () => markAssetFailed(profileId!, videoAssetId!, errJson));
    }
    if (jobId && profileId) {
      await safe("failJob", () => failJob(profileId!, jobId!, errJson));
    }

    // Best-effort refund. Only fires when spendCredits actually succeeded.
    // The InsufficientCreditsError branch returns 402 directly and never
    // reaches this catch, so creditsSpent is the right gate.
    if (creditsSpent && profileId && creditsAmount > 0 && creditJobKind) {
      await safe("refundCredits", () => refundCredits({
        profileId: profileId!,
        amount: creditsAmount,
        idempotencyKey: jobId
          ? `refund:${creditJobKind}:${jobId}`
          : `refund:${creditJobKind}:profile:${profileId}:${Date.now()}`,
        jobId: jobId ?? null,
        description: "Best-effort refund after generation failure",
        metadata: { reason: "generation_failed", originalError: errJson },
      }));
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
