/* eslint-disable @typescript-eslint/no-explicit-any */
import Replicate from "replicate";

import { GenerationCancelledError } from "@/lib/ai-providers/errors";

export { GenerationCancelledError, isGenerationCancelled } from "@/lib/ai-providers/errors";

/** A minimal view of a Replicate prediction surfaced to the onPrediction hook. */
export type PredictionTick = { id: string; status: string };

export type ReplicateRunHooks = {
  /**
   * Called for every prediction lifecycle tick (on create, each poll, and on
   * completion). Routes use it to persist the prediction id so a separate cancel
   * request can stop it. MUST be cheap and non-throwing (fire-and-forget any DB
   * work); exceptions are swallowed so they never break generation.
   */
  onPrediction?: (tick: PredictionTick) => void;
  /**
   * Polled on each wait tick (after the prediction id is recorded). Throw
   * `GenerationCancelledError` to abort the provider run and stop Replicate.
   */
  abortCheck?: () => Promise<void>;
};

type ReplicatePrediction = {
  id: string;
  status: string;
  output?: unknown;
  error?: string;
};

/** Parse `owner/name` or `owner/name:version` (same rule as the Replicate SDK). */
function parseModelRef(ref: string): { owner: string; name: string; version?: string } {
  const match = ref.match(/^([^/]+)\/([^/:]+)(?::(.+))?$/);
  if (!match?.[1] || !match[2]) {
    throw new Error(
      `Invalid reference to model version: ${ref}. Expected format: owner/name or owner/name:version`
    );
  }
  const owner = match[1];
  const name = match[2];
  const version = match[3];
  return version ? { owner, name, version } : { owner, name };
}

async function createPredictionFromRef(
  replicate: Replicate,
  ref: string,
  input: Record<string, unknown>
): Promise<ReplicatePrediction> {
  const { owner, name, version } = parseModelRef(ref);
  if (version) {
    return (await replicate.predictions.create({
      version,
      input,
    })) as ReplicatePrediction;
  }
  return (await replicate.predictions.create({
    model: `${owner}/${name}`,
    input,
  })) as ReplicatePrediction;
}

function emitPredictionTick(
  prediction: { id?: string; status?: string },
  hooks?: ReplicateRunHooks
): void {
  if (!prediction || typeof prediction !== "object") return;
  const id = prediction.id;
  if (hooks?.onPrediction && typeof id === "string" && id) {
    try {
      hooks.onPrediction({ id, status: String(prediction.status ?? "") });
    } catch {
      /* hooks must never break generation */
    }
  }
}

function isCancelledStatus(status: string | undefined): boolean {
  return status === "canceled" || status === "aborted";
}

/**
 * Create + wait loop (instead of `replicate.run`) so we can poll `abortCheck`
 * between provider polls and record the prediction id before the first wait tick.
 */
async function runReplicateOnce(
  replicate: Replicate,
  model: string,
  options: { input: Record<string, unknown> },
  hooks?: ReplicateRunHooks
): Promise<unknown> {
  const prediction = await createPredictionFromRef(replicate, model, options.input);
  emitPredictionTick(prediction, hooks);

  const final = await replicate.wait(prediction as any, { interval: 500 }, async (updated) => {
    emitPredictionTick(updated, hooks);
    if (isCancelledStatus(updated.status)) {
      throw new GenerationCancelledError();
    }
    if (hooks?.abortCheck) {
      try {
        await hooks.abortCheck();
      } catch (e) {
        if (e instanceof GenerationCancelledError) {
          try {
            await replicate.predictions.cancel(updated.id);
          } catch {
            /* best-effort — cancel endpoint may have already stopped it */
          }
          throw e;
        }
        throw e;
      }
    }
    return false;
  });

  if (isCancelledStatus(final.status)) {
    throw new GenerationCancelledError();
  }
  if (final.status === "failed") {
    throw new Error(`Prediction failed: ${final.error ?? "unknown error"}`);
  }

  // `replicate.run` transforms output to FileOutput; routes normalize via extractMediaUrl.
  return final.output;
}

/** Shared Replicate 429 backoff used across the generation routes. */
export async function runReplicateWithRetry(
  replicate: Replicate,
  model: `${string}/${string}` | string,
  options: { input: Record<string, unknown> },
  maxRetries = 10,
  hooks?: ReplicateRunHooks
): Promise<unknown> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await runReplicateOnce(replicate, model, options, hooks);
    } catch (e: any) {
      if (e instanceof GenerationCancelledError) throw e;
      const errMsg = e.message || String(e);
      if (errMsg.includes("429")) {
        let delayMs = 15000;
        try {
          const match = errMsg.match(/"retry_after":\s*(\d+)/);
          if (match?.[1]) delayMs = (parseInt(match[1], 10) + 2) * 1000;
        } catch {
          /* ignore */
        }
        console.warn(
          `[Replicate 429] Retrying in ${delayMs / 1000}s (${i + 1}/${maxRetries})...`
        );
        await new Promise((res) => setTimeout(res, delayMs));
      } else {
        throw e;
      }
    }
  }
  throw new Error(`Failed to run replicate model ${model} after ${maxRetries} retries (rate limits).`);
}

/** Normalize Replicate file outputs (string, FileOutput, arrays, etc.). */
export function extractMediaUrl(res: any): string {
  if (typeof res === "string") return res;
  if (res && typeof res === "object") {
    if (typeof res.url === "function") {
      const u = res.url();
      return u && u.href ? u.href : String(u);
    }
    if (res instanceof URL) return res.toString();
    if (typeof res.toString === "function") {
      const s = res.toString();
      if (s.startsWith("http")) return s;
    }
    if ("audio" in res && typeof res.audio?.url === "function") return res.audio.url();
    if ("audio" in res && typeof res.audio?.url === "string") return res.audio.url;
    if ("audio_url" in res) return res.audio_url;
    if ("audio_file" in res) return res.audio_file;
    if ("url" in res && typeof res.url === "string") return res.url;
    if ("video" in res && typeof res.video === "string") return res.video;
    if ("output" in res && typeof res.output === "string") return res.output;
    if (Array.isArray(res)) {
      const first = res[0];
      return typeof first?.url === "function" ? first.url() : String(first);
    }
  }
  return String(res);
}

/** GPT-5 on Replicate returns an array of string chunks — concatenate. */
export function flattenReplicateTextChunks(res: unknown): string {
  if (Array.isArray(res)) return res.join("");
  if (typeof res === "string") return res;
  return String(res ?? "");
}

export function stripMarkdownFences(text: string): string {
  return text.replace(/^```[a-zA-Z0-9]*\s*/m, "").replace(/\s*```$/m, "").trim();
}
