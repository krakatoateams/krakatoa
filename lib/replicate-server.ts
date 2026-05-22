/* eslint-disable @typescript-eslint/no-explicit-any */
import Replicate from "replicate";

/** Shared Replicate 429 backoff — matches `app/api/generate/route.ts` behavior. */
export async function runReplicateWithRetry(
  replicate: Replicate,
  model: `${string}/${string}` | string,
  options: { input: Record<string, unknown> },
  maxRetries = 10
): Promise<unknown> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await replicate.run(model as any, options as any);
    } catch (e: any) {
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
