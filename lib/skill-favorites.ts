export const SKILL_FAVORITES_KEY = "krakatoa:skills:favorites";
export const SKILL_FAVORITES_EVENT = "krakatoa:skills:favorites";

const MAX_FAVORITES = 48;

function isFavoriteId(id: unknown): id is string {
  return typeof id === "string" && id.length >= 2 && id.length <= 48;
}

export function loadSkillFavorites(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SKILL_FAVORITES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of parsed) {
      if (!isFavoriteId(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= MAX_FAVORITES) break;
    }
    return out;
  } catch {
    return [];
  }
}

export function saveSkillFavorites(ids: string[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SKILL_FAVORITES_KEY, JSON.stringify(ids.slice(0, MAX_FAVORITES)));
  } catch {
    // private mode — callers still keep in-memory state
  }
  window.dispatchEvent(new Event(SKILL_FAVORITES_EVENT));
}

export function toggleSkillFavorite(id: string, current: string[]): string[] {
  const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
  saveSkillFavorites(next);
  return next;
}
