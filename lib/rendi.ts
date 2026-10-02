import "server-only";

import { isCancellation } from "@/lib/replicate-server";

/**
 * Shared client for Rendi (cloud FFmpeg API: https://rendi.dev).
 *
 * Rendi runs an FFmpeg command against hosted input files and returns hosted
 * output URLs. The flow is async: POST a command → poll the command id until
 * it succeeds → read the output file `storage_url`.
 *
 * Requires the RENDI_API_KEY environment variable.
 *
 * The unified Reels Creator route (generate-reels) uses these helpers via the
 * lib/reels-pipeline/rendi-stitch.ts wrappers. The dev-only test-stitch route
 * still keeps its own inline copy of this logic.
 */

const RENDI_BASE = "https://api.rendi.dev/v1";

export interface RendiPollData {
  status?: string;
  output_files?: Record<string, { storage_url?: string } | undefined>;
  error_message?: unknown;
  error_status?: unknown;
  [key: string]: unknown;
}

export class RendiCommandError extends Error {
  readonly errorStatus?: string;
  readonly errorMessage?: string;
  readonly code?: string;

  constructor(message: string, errorStatus?: string, errorMessage?: string) {
    super(message);
    this.name = "RendiCommandError";
    this.errorStatus = errorStatus;
    this.errorMessage = errorMessage;
    if (errorStatus && /^[A-Z0-9_]{1,64}$/.test(errorStatus)) {
      this.code = errorStatus;
    }
  }
}

export function sanitizeRendiErrorMessage(raw: unknown): string {
  if (typeof raw !== "string" && !raw) return "";
  const str = typeof raw === "string" ? raw : String(raw);
  return str
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

export interface RunRendiOptions {
  apiKey?: string;
  /** Delay between status polls. Default 3000ms. */
  pollIntervalMs?: number;
  /** Maximum number of polls before timing out. Default 120 (~6 min at 3s). */
  maxAttempts?: number;
  /** Polled before each status check; throw to abort (e.g. user cancelled generation). */
  abortCheck?: () => Promise<void>;
  /**
   * When false, do not retry deterministic Rendi command failures (FAILED / ERROR).
   * Transport errors (non-OK HTTP status from API) are still retried. Default true.
   */
  retryOnCommandFailure?: boolean;
}

export function getRendiApiKey(): string {
  const key = process.env.RENDI_API_KEY;
  if (!key) {
    throw new Error("Video processing is not configured.");
  }
  return key;
}

/**
 * Run a single FFmpeg command on Rendi and resolve once it succeeds.
 *
 * @param ffmpegCommand FFmpeg args using `{{alias}}` placeholders, e.g.
 *   `-i {{in_video}} -vn -map 0:a:0 -acodec libmp3lame -q:a 2 {{out_a}}`
 * @param inputFiles map of input alias → source URL
 * @param outputFiles map of output alias → output filename
 */
export async function runRendiCommand(
  ffmpegCommand: string,
  inputFiles: Record<string, string>,
  outputFiles: Record<string, string>,
  options: RunRendiOptions = {},
): Promise<RendiPollData> {
  const apiKey = options.apiKey ?? getRendiApiKey();
  const pollIntervalMs = options.pollIntervalMs ?? 3000;
  const maxAttempts = options.maxAttempts ?? 120;

  const resp = await fetch(`${RENDI_BASE}/run-ffmpeg-command`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({
      ffmpeg_command: ffmpegCommand,
      input_files: inputFiles,
      output_files: outputFiles,
    }),
  });

  if (!resp.ok) {
    throw new Error(`Rendi API failed (${resp.status}).`);
  }

  const { command_id } = (await resp.json()) as { command_id?: string };
  if (!command_id) {
    throw new Error("Rendi did not return a command_id.");
  }

  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    if (options.abortCheck) {
      await options.abortCheck();
    }
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const poll = await fetch(`${RENDI_BASE}/commands/${command_id}`, {
      headers: { "X-API-KEY": apiKey },
    });
    if (!poll.ok) continue;

    const data = (await poll.json()) as RendiPollData;
    const status = (data.status || "").toUpperCase();
    if (status === "SUCCESS" || status === "COMPLETED") return data;
    if (status === "FAILED" || status === "ERROR") {
      const sanitizedStatus =
        typeof data.error_status === "string" && data.error_status.trim()
          ? data.error_status.trim().slice(0, 64)
          : undefined;
      const sanitizedMessage = sanitizeRendiErrorMessage(data.error_message);
      const detailParts = [
        sanitizedStatus ? `status=${sanitizedStatus}` : null,
        sanitizedMessage ? `message=${sanitizedMessage}` : null,
      ].filter(Boolean);
      const errText =
        detailParts.length > 0
          ? `Rendi command failed (${detailParts.join(", ")})`
          : "Rendi command failed.";
      throw new RendiCommandError(errText, sanitizedStatus, sanitizedMessage);
    }
  }

  // Typed so callers with retryOnCommandFailure=false (editor) don't re-poll past their time budget.
  throw new RendiCommandError("Rendi polling timed out.", "RENDI_POLL_TIMEOUT");
}

const RENDI_MAX_RETRIES = 3;

/** Run Rendi with bounded retries on transient failures (not for user cancel). */
export async function runRendiCommandWithRetry(
  ffmpegCommand: string,
  inputFiles: Record<string, string>,
  outputFiles: Record<string, string>,
  options: RunRendiOptions = {},
): Promise<RendiPollData> {
  const retryOnCommandFailure = options.retryOnCommandFailure ?? true;
  let lastError: unknown;
  for (let attempt = 0; attempt < RENDI_MAX_RETRIES; attempt++) {
    try {
      return await runRendiCommand(ffmpegCommand, inputFiles, outputFiles, options);
    } catch (e) {
      if (isCancellation(e)) throw e;
      if (!retryOnCommandFailure && e instanceof RendiCommandError) {
        throw e;
      }
      lastError = e;
      if (attempt < RENDI_MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`rendi self-check: ${msg}`);
}

export async function rendiSelfCheck(): Promise<void> {
  const rawMsg = "Failed at https://storage.supabase.co/v1/object/sign/krakatoa/user/video.mp4?token=eyJhbGciOiJIUzI1NiJ9.eyJleHAiOjE3OTA5NTQzODF9.abc with error";
  const sanitized = sanitizeRendiErrorMessage(rawMsg);
  assert(!sanitized.includes("token="), "tokens must be stripped");
  assert(sanitized.includes("[redacted-url]"), "URLs must be redacted");

  const err = new RendiCommandError("Rendi command failed (status=ACCOUNT_FFMPEG_RUN_TIMEOUT)", "ACCOUNT_FFMPEG_RUN_TIMEOUT", "Timeout");
  assert(err.name === "RendiCommandError", "name is RendiCommandError");
  assert(err.code === "ACCOUNT_FFMPEG_RUN_TIMEOUT", "code is errorStatus");
  assert(err.errorStatus === "ACCOUNT_FFMPEG_RUN_TIMEOUT", "errorStatus set");
  assert(err.errorMessage === "Timeout", "errorMessage set");

  // Issue #244: a poll timeout must not be retried when command retries are off (editor time budget).
  const realFetch = globalThis.fetch;
  let submits = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    if (String(url).endsWith("/run-ffmpeg-command")) submits += 1;
    return new Response(JSON.stringify({ command_id: "c1", status: "PROCESSING" }));
  }) as typeof fetch;
  try {
    const opts = { apiKey: "k", pollIntervalMs: 0, maxAttempts: 1, retryOnCommandFailure: false };
    const timedOut = await runRendiCommandWithRetry("", {}, {}, opts).catch((e: unknown) => e);
    assert(timedOut instanceof RendiCommandError && timedOut.code === "RENDI_POLL_TIMEOUT", "poll timeout is typed");
    assert(submits === 1, "poll timeout not retried when retryOnCommandFailure=false");
  } finally {
    globalThis.fetch = realFetch;
  }
}

if (require.main === module) {
  rendiSelfCheck().then(() => console.log("rendiSelfCheck: ok"));
}

/** Read a hosted output URL from a successful Rendi poll result. */
export function getRendiOutputUrl(pollData: RendiPollData, alias: string): string {
  const url = pollData.output_files?.[alias]?.storage_url;
  if (!url) throw new Error(`Rendi output "${alias}" URL not found.`);
  return url;
}

/**
 * Extract the first audio stream from a video URL and return a hosted MP3 URL.
 * Throws if the video has no audio track or Rendi fails — callers decide whether
 * to treat that as fatal or to continue without audio.
 */
export async function extractAudioMp3(
  videoUrl: string,
  options: RunRendiOptions = {},
): Promise<string> {
  const result = await runRendiCommand(
    `-i {{in_video}} -vn -map 0:a:0 -acodec libmp3lame -q:a 2 {{out_a}}`,
    { in_video: videoUrl },
    { out_a: "audio.mp3" },
    options,
  );
  return getRendiOutputUrl(result, "out_a");
}
