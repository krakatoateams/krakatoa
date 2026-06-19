/**
 * Voiceover + transcription stage shared by Seedance and Veo per-scene reels.
 *
 * A single MiniMax TTS pass speaks the full continuous narration; Whisper then
 * measures it word-by-word. If the measured duration is off-target by more than
 * ~15%, TTS re-runs once at a corrected speed. The unified correction formula
 *   corrected = clamp(0.5, 2, initialSpeed * firstRatio)
 * reproduces BOTH legacy routes exactly: Seedance used initialSpeed 1.0 (so the
 * factor was just firstRatio), Veo per-scene used initialSpeed 0.95. Any small
 * residual is absorbed by the FFmpeg `atempo` factor returned here.
 */
import { runWithRetry } from "@/lib/reels-helpers";
import { extractMediaUrl } from "@/lib/replicate-server";
import type { ReelsPipelineContext, WordChunk } from "./types";

/** Normalize Whisper's two possible output shapes into flat word chunks. */
export function parseWhisperWords(wRes: unknown): WordChunk[] {
  const words: WordChunk[] = [];
  const res = wRes as {
    chunks?: { text?: string; timestamp?: [number, number] }[];
    segments?: {
      start?: number;
      end?: number;
      words?: { word?: string; text?: string; start?: number; end?: number }[];
    }[];
  } | null;
  if (res?.chunks) {
    for (const c of res.chunks) {
      const txt = String(c.text || "").trim();
      if (!txt) continue;
      words.push({
        text: txt,
        start: c.timestamp?.[0] ?? 0,
        end: c.timestamp?.[1] ?? (c.timestamp?.[0] ?? 0) + 0.3,
      });
    }
  } else if (res?.segments) {
    for (const seg of res.segments) {
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

/** One TTS pass at `speed`, immediately measured by Whisper. */
export async function generateTtsAndTranscribe(
  ctx: ReelsPipelineContext,
  params: { text: string; speed: number; voiceId: string; emotion: string }
): Promise<{ audioUrl: string; words: WordChunk[]; duration: number }> {
  const ttsRes = await runWithRetry(
    ctx.replicate,
    ctx.refs.ttsRef,
    {
      input: {
        text: params.text,
        voice_id: params.voiceId,
        emotion: params.emotion,
        speed: params.speed,
        pitch: 0,
        language_boost: "English",
        audio_format: "mp3",
        bitrate: 128000,
      },
    },
    10,
    ctx.recorder
  );
  const url = extractMediaUrl(ttsRes);
  if (!url || !url.startsWith("http")) {
    console.error("Failed to extract TTS audio URL:", ttsRes);
    throw new Error("Failed to generate TTS audio.");
  }

  const wRes = await runWithRetry(
    ctx.replicate,
    ctx.refs.whisperRef,
    { input: { audio: url, language: "english", timestamp: "word", batch_size: 64 } },
    10,
    ctx.recorder
  );
  const words = parseWhisperWords(wRes);
  if (words.length === 0) {
    throw new Error("Whisper returned no word timestamps.");
  }
  const dur = words[words.length - 1].end;
  return { audioUrl: url, words, duration: dur };
}

/**
 * Full TTS+Whisper fit pass. Returns the measured word timeline plus the
 * residual `audioSpeedFactor` for the FFmpeg merge so the final reel lands on
 * exactly `totalDuration` seconds.
 */
export async function runTtsPipeline(
  ctx: ReelsPipelineContext,
  params: {
    fullNarration: string;
    voiceId: string;
    emotion: string;
    totalDuration: number;
    initialSpeed: number;
  }
): Promise<{
  audioUrl: string;
  words: WordChunk[];
  audioEndTotal: number;
  audioSpeedFactor: number;
  retried: boolean;
}> {
  const { fullNarration, voiceId, emotion, totalDuration, initialSpeed } = params;

  let {
    audioUrl,
    words,
    duration: audioEndTotal,
  } = await generateTtsAndTranscribe(ctx, {
    text: fullNarration,
    speed: initialSpeed,
    voiceId,
    emotion,
  });

  const RATIO_TOLERANCE_LOW = 0.85;
  const RATIO_TOLERANCE_HIGH = 1.15;
  const firstRatio = audioEndTotal / totalDuration;
  let retried = false;
  if (firstRatio < RATIO_TOLERANCE_LOW || firstRatio > RATIO_TOLERANCE_HIGH) {
    const corrected = Math.max(0.5, Math.min(2, initialSpeed * firstRatio));
    ({ audioUrl, words, duration: audioEndTotal } = await generateTtsAndTranscribe(ctx, {
      text: fullNarration,
      speed: corrected,
      voiceId,
      emotion,
    }));
    retried = true;
  }

  // Residual atempo to land exactly on totalDuration (both speed-up and slow-down).
  let audioSpeedFactor = 1;
  const finalRatio = audioEndTotal / totalDuration;
  if (Math.abs(1 - finalRatio) > 0.01) {
    audioSpeedFactor = Math.max(0.5, Math.min(2, finalRatio));
  }

  return { audioUrl, words, audioEndTotal, audioSpeedFactor, retried };
}
