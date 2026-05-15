import Replicate from "replicate";

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

export async function runWithRetry(
  replicate: Replicate,
  model: `${string}/${string}` | `${string}/${string}:${string}`,
  options: { input: Record<string, unknown> },
  maxRetries = 10
) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await replicate.run(model, options);
    } catch (e: unknown) {
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
