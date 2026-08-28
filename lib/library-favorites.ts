export const LIBRARY_FAVORITES_KEY = "krakatoa:library:favorites";

export function loadLibraryFavorites(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(LIBRARY_FAVORITES_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(parsed) ? (parsed as string[]) : []);
  } catch {
    return new Set();
  }
}

export function libraryFavoriteCount(): number {
  return loadLibraryFavorites().size;
}
