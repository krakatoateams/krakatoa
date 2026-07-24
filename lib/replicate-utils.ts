import Replicate from "replicate";
import {
  ReplicateCancellationError,
  type ReplicateRunHooks,
} from "@/lib/replicate-server";

export function extractMediaUrl(res: unknown): string {
  if (typeof res === "string") return res;
  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>;
    if (typeof obj.url === "function") {
      const u = (obj.url as () => URL | string)();
      if (u && typeof u === "object" && "href" in u) return (u as URL).href;
      return String(u);
    }
    if (res instanceof URL) return res.toString();
    if (typeof obj.toString === "function") {
      const s = obj.toString();
      if (s.startsWith("http")) return s;
    }
    if (typeof obj.url === "string") return obj.url;
    if (Array.isArray(res)) {
      const first = res[0] as Record<string, unknown> | string | undefined;
      if (typeof first === "string") return first;
      if (first && typeof first.url === "function") {
        return String((first.url as () => URL | string)());
      }
    }
  }
  return String(res);
}

export function createReplicateClient() {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error("REPLICATE_API_TOKEN is not set.");
  }
  return new Replicate({ auth: token });
}

/** Start a Replicate prediction without blocking until completion (for long-running jobs). */
export async function createPredictionWithRetry(
  replicate: Replicate,
  model: `${string}/${string}` | `${string}/${string}:${string}`,
  input: Record<string, unknown>,
  maxRetries = 10,
): Promise<{ id: string }> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const prediction = await replicate.predictions.create({ model, input });
      if (!prediction?.id) throw new Error("Replicate did not return a prediction id.");
      return { id: prediction.id };
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes("429")) {
        let delayMs = 15000;
        const match = errMsg.match(/"retry_after":\s*(\d+)/);
        if (match?.[1]) delayMs = (parseInt(match[1], 10) + 2) * 1000;
        console.warn(
          `[Replicate 429] create retry in ${delayMs / 1000}s (${i + 1}/${maxRetries})...`,
        );
        await new Promise((res) => setTimeout(res, delayMs));
      } else {
        throw e;
      }
    }
  }
  throw new Error(`Replicate rate limit exceeded creating prediction for ${model}`);
}

export async function runWithRetry(
  replicate: Replicate,
  model: `${string}/${string}` | `${string}/${string}:${string}`,
  options: { input: Record<string, unknown> },
  maxRetries = 10,
  hooks?: ReplicateRunHooks
) {
  for (let i = 0; i < maxRetries; i++) {
    // Track this attempt's last status so an external cancellation (status
    // 'canceled', which the SDK does NOT throw on) surfaces as an explicit error.
    let lastStatus: string | undefined;
    const progress = (prediction: { id?: string; status?: string } | null) => {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await replicate.run(model, options, progress as any);
      if (lastStatus === "canceled" || lastStatus === "aborted") {
        throw new ReplicateCancellationError();
      }
      return result;
    } catch (e: unknown) {
      if (e instanceof ReplicateCancellationError) throw e;
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes("429")) {
        let delayMs = 15000;
        const match = errMsg.match(/"retry_after":\s*(\d+)/);
        if (match?.[1]) {
          delayMs = (parseInt(match[1], 10) + 2) * 1000;
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
  throw new Error(`Replicate rate limit exceeded for ${model}`);
}
