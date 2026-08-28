import type { CreationHistoryItem } from "@/lib/creations";

/** Extract a `user_creations.id` from a generate-* JSON body. */
export function previewIdFromGenerateResponse(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;

  const top = record.historyItem;
  if (top && typeof top === "object") {
    const id = (top as { id?: unknown }).id;
    if (typeof id === "string" && id.trim()) return id;
  }

  const images = record.images;
  if (Array.isArray(images)) {
    for (const image of images) {
      if (!image || typeof image !== "object") continue;
      const item = (image as { historyItem?: { id?: unknown } }).historyItem;
      if (item && typeof item.id === "string" && item.id.trim()) return item.id;
    }
  }

  return null;
}

/** Load one signed history row for the preview modal. */
export async function fetchCreationForPreview(
  id: string
): Promise<CreationHistoryItem | null> {
  const params = new URLSearchParams({
    ids: id,
    limit: "1",
  });
  const res = await fetch(`/api/creations/history?${params}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { items?: CreationHistoryItem[] };
  return data.items?.[0] ?? null;
}
