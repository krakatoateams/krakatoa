/**
 * Shared Reels Creator helpers (JSON extraction, ASS color/time formatting,
 * Replicate retry). Used by the unified `app/api/generate-reels/route.ts` and the
 * `lib/reels-pipeline/` modules.
 */
import Replicate from "replicate";
import {
  ReplicateCancellationError,
  type ReplicateRunHooks,
} from "@/lib/replicate-server";

export function extractJson(raw: string): unknown {
  const cleaned = raw.replace(/```json\n?|\n?```/g, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* fall through */
  }

  const findBalanced = (text: string, open: string, close: string): string | null => {
    const start = text.indexOf(open);
    if (start === -1) return null;
    let depth = 0;
    for (let i = start; i < text.length; i++) {
      if (text[i] === open) depth++;
      else if (text[i] === close) {
        depth--;
        if (depth === 0) return text.slice(start, i + 1);
      }
    }
    return null;
  };

  const arr = findBalanced(cleaned, "[", "]");
  if (arr) {
    try {
      return JSON.parse(arr);
    } catch {
      /* fall through */
    }
  }
  const obj = findBalanced(cleaned, "{", "}");
  if (obj) {
    try {
      return JSON.parse(obj);
    } catch {
      /* fall through */
    }
  }
  throw new Error("No valid JSON found in LLM response");
}

export function hexToAssColor(hex: string): string {
  const r = hex.slice(1, 3);
  const g = hex.slice(3, 5);
  const b = hex.slice(5, 7);
  return `&H00${b}${g}${r}`;
}

export function formatAssTime(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

export async function runWithRetry(
  replicate: Replicate,
  model: string,
  options: { input: Record<string, unknown> },
  maxRetries = 10,
  hooks?: ReplicateRunHooks
): Promise<unknown> {
  for (let i = 0; i < maxRetries; i++) {
    // Per-attempt status tracking + prediction recording. An external cancellation
    // makes replicate.run resolve with status 'canceled' (it only throws on
    // 'failed'), so we detect it here and surface a ReplicateCancellationError.
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
      const result = await replicate.run(model as `${string}/${string}`, options as { input: object }, progress as any);
      if (lastStatus === "canceled" || lastStatus === "aborted") {
        throw new ReplicateCancellationError();
      }
      return result;
    } catch (e: unknown) {
      if (e instanceof ReplicateCancellationError) throw e;
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes("429")) {
        let delayMs = 15000;
        try {
          const match = errMsg.match(/"retry_after":\s*(\d+)/);
          if (match?.[1]) delayMs = (parseInt(match[1], 10) + 2) * 1000;
        } catch {
          /* use default */
        }
        console.warn(
          `[Replicate 429 Rate Limit] Retrying in ${delayMs / 1000}s (Attempt ${i + 1}/${maxRetries})...`
        );
        await new Promise((res) => setTimeout(res, delayMs));
      } else {
        throw e;
      }
    }
  }
  throw new Error(`Failed to run replicate model ${model} after ${maxRetries} retries due to rate limits.`);
}
