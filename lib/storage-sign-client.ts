/** Browser helpers for /api/storage/sign — no secrets. */

export type SignedUrlResponse = {
  url: string;
  expiresAt: string;
  storagePath: string;
};

export async function fetchSignedUrl(params: {
  path?: string;
  assetId?: string;
  ttl?: number;
}): Promise<SignedUrlResponse> {
  const q = new URLSearchParams();
  if (params.assetId) q.set("assetId", params.assetId);
  else if (params.path) q.set("path", params.path);
  else throw new Error("path or assetId required");
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
