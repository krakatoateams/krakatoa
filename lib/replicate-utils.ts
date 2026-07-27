import Replicate from "replicate";
import {
  extractMediaUrl,
  runReplicateWithRetry,
  type ReplicateRunHooks,
} from "@/lib/replicate-server";

/** Canonical implementations live in `replicate-server.ts` — re-exported here for photo/video routes. */
export { extractMediaUrl, type ReplicateRunHooks };
export const runWithRetry = runReplicateWithRetry;

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
