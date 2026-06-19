/* eslint-disable @typescript-eslint/no-explicit-any */
import Replicate from "replicate";

/**
 * Thrown by `runReplicateWithRetry` when the underlying Replicate prediction was
 * cancelled (status `canceled`/`aborted`) — typically because the user hit the
 * Cancel button, which calls `replicate.predictions.cancel(id)` from a separate
 * request. Routes catch this to mark the job 'cancelled' (not 'failed') and
 * refund, instead of surfacing a generic provider failure.
 *
 * NOTE: the Replicate JS SDK's `run()` only THROWS on `failed`; a cancelled
 * prediction makes `run()` resolve with `undefined` output. We detect the
 * cancelled status via the progress callback and throw this explicitly.
 */
export class ReplicateCancellationError extends Error {
  readonly code = "GENERATION_CANCELLED";
  constructor(message = "Generation was cancelled.") {
    super(message);
    this.name = "ReplicateCancellationError";
  }
}

/** Type guard for the cancellation error (also matches the code, post-serialization). */
export function isCancellation(e: unknown): e is ReplicateCancellationError {
  return (
    e instanceof ReplicateCancellationError ||
    (e instanceof Error && (e as any).code === "GENERATION_CANCELLED")
  );
}

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
};

/** Shared Replicate 429 backoff — matches `app/api/generate/route.ts` behavior. */
export async function runReplicateWithRetry(
  replicate: Replicate,
  model: `${string}/${string}` | string,
  options: { input: Record<string, unknown> },
  maxRetries = 10,
  hooks?: ReplicateRunHooks
): Promise<unknown> {
  for (let i = 0; i < maxRetries; i++) {
    // Track the last status seen by the progress callback for THIS attempt so we
    // can distinguish a user cancellation from a normal completion/failure.
    let lastStatus: string | undefined;
    const progress = (prediction: any) => {
      if (!prediction || typeof prediction !== "object") return;
      lastStatus = prediction.status;
      const id = prediction.id;
      if (hooks?.onPrediction && typeof id === "string" && id) {
        try {
          hooks.onPrediction({ id, status: String(prediction.status ?? "") });
        } catch {
          /* hooks must never break generation */
        }
      }
    };
    try {
      const result = await replicate.run(model as any, options as any, progress);
      // A cancelled prediction resolves with undefined output (SDK only throws on
      // 'failed'). Surface it explicitly so the route can refund + mark cancelled.
      if (lastStatus === "canceled" || lastStatus === "aborted") {
        throw new ReplicateCancellationError();
      }
      return result;
    } catch (e: any) {
      if (e instanceof ReplicateCancellationError) throw e;
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
