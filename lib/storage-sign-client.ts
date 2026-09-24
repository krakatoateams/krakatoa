/** Browser helpers for /api/storage/sign — no secrets. */

export type SignedUrlResponse = {
  url: string;
  expiresAt: string;
  storagePath: string;
};

/**
 * Dedupe/cache resolved signed URLs per (path|assetId, ttl) for this tab's session.
 * Same target can be requested independently by several mounted components
 * (editor preview, duration probe, ...) within the same load — share one round
 * trip instead of re-hitting /api/storage/sign for each. Session-scoped (module
 * memory, cleared on reload) and bounded; skips a re-fetch only while the cached
 * URL still has real time left, so an expired/near-expired entry always re-signs.
 * ponytail: FIFO eviction, not LRU — fine at this cap, revisit if hit rate matters.
 */
const RESOLVED_CACHE_LIMIT = 200;
const MIN_REMAINING_MS = 60_000;
const resolvedCache = new Map<string, SignedUrlResponse>();
const inFlight = new Map<string, Promise<SignedUrlResponse>>();

function cacheKey(params: { path?: string; assetId?: string; ttl?: number }): string {
  return `${params.assetId ? `a:${params.assetId}` : `p:${params.path}`}:${params.ttl ?? "default"}`;
}

export async function fetchSignedUrl(params: {
  path?: string;
  assetId?: string;
  ttl?: number;
}): Promise<SignedUrlResponse> {
  if (!params.assetId && !params.path) throw new Error("path or assetId required");
  const key = cacheKey(params);

  const cached = resolvedCache.get(key);
  if (cached && new Date(cached.expiresAt).getTime() - Date.now() > MIN_REMAINING_MS) {
    return cached;
  }

  const existing = inFlight.get(key);
  if (existing) return existing;

  const promise = signUrl(params)
    .then((data) => {
      resolvedCache.set(key, data);
      if (resolvedCache.size > RESOLVED_CACHE_LIMIT) {
        const oldestKey = resolvedCache.keys().next().value;
        if (oldestKey !== undefined) resolvedCache.delete(oldestKey);
      }
      return data;
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

async function signUrl(params: {
  path?: string;
  assetId?: string;
  ttl?: number;
}): Promise<SignedUrlResponse> {
  const q = new URLSearchParams();
  if (params.assetId) q.set("assetId", params.assetId);
  else if (params.path) q.set("path", params.path);
  if (params.ttl) q.set("ttl", String(params.ttl));

  const res = await fetch(`/api/storage/sign?${q}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to sign URL");
  return data as SignedUrlResponse;
}

export async function fetchSignedUrlBatch(
  items: Array<{ path?: string; assetId?: string }>,
  ttl?: number,
): Promise<SignedUrlResponse[]> {
  const res = await fetch("/api/storage/sign-batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items, ttl }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Failed to sign URLs");
  return (data.items ?? []).filter((i: { url?: string }) => i.url) as SignedUrlResponse[];
}
