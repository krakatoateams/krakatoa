/**
 * Shared client for Rendi (cloud FFmpeg API: https://rendi.dev).
 *
 * Rendi runs an FFmpeg command against hosted input files and returns hosted
 * output URLs. The flow is async: POST a command → poll the command id until
 * it succeeds → read the output file `storage_url`.
 *
 * Requires the RENDI_API_KEY environment variable.
 *
 * Existing routes (generate, generate-veo, test-stitch) have their own inline
 * copies of this logic; they can migrate to these helpers over time.
 */

const RENDI_BASE = "https://api.rendi.dev/v1";

export interface RendiPollData {
  status?: string;
  output_files?: Record<string, { storage_url?: string } | undefined>;
  error_message?: unknown;
  error_status?: unknown;
  [key: string]: unknown;
}

export interface RunRendiOptions {
  apiKey?: string;
  /** Delay between status polls. Default 3000ms. */
  pollIntervalMs?: number;
  /** Maximum number of polls before timing out. Default 120 (~6 min at 3s). */
  maxAttempts?: number;
}

export function getRendiApiKey(): string {
  const key = process.env.RENDI_API_KEY;
  if (!key) {
    throw new Error("RENDI_API_KEY is not set.");
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
    const errText = await resp.text();
    throw new Error(`Rendi API failed (${resp.status}): ${errText || resp.statusText}`);
  }

  const { command_id } = (await resp.json()) as { command_id?: string };
  if (!command_id) {
    throw new Error("Rendi did not return a command_id.");
  }

  for (let attempts = 0; attempts < maxAttempts; attempts++) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    const poll = await fetch(`${RENDI_BASE}/commands/${command_id}`, {
      headers: { "X-API-KEY": apiKey },
    });
    if (!poll.ok) continue;

    const data = (await poll.json()) as RendiPollData;
    const status = (data.status || "").toUpperCase();
    if (status === "SUCCESS" || status === "COMPLETED") return data;
    if (status === "FAILED" || status === "ERROR") {
      throw new Error(
        `Rendi failed: ${JSON.stringify(data.error_message || data.error_status || data)}`,
      );
    }
  }

  throw new Error("Rendi polling timed out.");
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
