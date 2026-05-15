import type { ProductPhotoHistoryItem } from "@/lib/product-photo";
import { clientStoragePrefix } from "@/lib/product-photo";
import { getSupabase } from "@/lib/supabase";
import { STORAGE_BUCKET } from "@/lib/storage-buckets";

const MAX_ITEMS = 100;

function manifestPath(clientId: string): string {
  return `${clientStoragePrefix(clientId)}/history.json`;
}

function storage() {
  return getSupabase().storage.from(STORAGE_BUCKET);
}

function sortNewestFirst(items: ProductPhotoHistoryItem[]): ProductPhotoHistoryItem[] {
  return [...items].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function dedupe(items: ProductPhotoHistoryItem[]): ProductPhotoHistoryItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.storagePath || item.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function readManifest(clientId: string): Promise<ProductPhotoHistoryItem[]> {
  const path = manifestPath(clientId);
  const { data, error } = await storage().download(path);
  if (error || !data) return [];

  try {
    const text = await data.text();
    const parsed = JSON.parse(text) as { items?: ProductPhotoHistoryItem[] };
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

export async function writeManifest(
  clientId: string,
  items: ProductPhotoHistoryItem[]
): Promise<void> {
  const path = manifestPath(clientId);
  const body = JSON.stringify({ items: sortNewestFirst(dedupe(items)).slice(0, MAX_ITEMS) });

  const { error } = await storage().upload(path, body, {
    contentType: "application/json",
    cacheControl: "60",
    upsert: true,
  });

  if (error) {
    throw new Error(`Failed to update history manifest: ${error.message}`);
  }
}

export async function appendManifestItem(
  clientId: string,
  item: ProductPhotoHistoryItem
): Promise<void> {
  const existing = await readManifest(clientId);
  await writeManifest(clientId, [item, ...existing.filter((i) => i.id !== item.id)]);
}
