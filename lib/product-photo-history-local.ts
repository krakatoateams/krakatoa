import type { ProductPhotoHistoryItem } from "@/lib/product-photo";

const LOCAL_KEY = "krakatoa_product_photo_history";
const MAX_ITEMS = 100;

export function getLocalHistory(clientId: string): ProductPhotoHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const byClient = JSON.parse(raw) as Record<string, ProductPhotoHistoryItem[]>;
    return byClient[clientId] ?? [];
  } catch {
    return [];
  }
}

export function saveLocalHistoryItem(clientId: string, item: ProductPhotoHistoryItem): void {
  if (typeof window === "undefined") return;
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const byClient: Record<string, ProductPhotoHistoryItem[]> = raw ? JSON.parse(raw) : {};
    const existing = byClient[clientId] ?? [];
    const seen = new Set<string>();
    const merged = [item, ...existing.filter((i) => i.id !== item.id)].filter((i) => {
      const key = i.storagePath || i.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    byClient[clientId] = merged.slice(0, MAX_ITEMS);
    localStorage.setItem(LOCAL_KEY, JSON.stringify(byClient));
  } catch {
    /* ignore quota errors */
  }
}
