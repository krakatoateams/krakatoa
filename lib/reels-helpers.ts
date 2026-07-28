/**
 * Shared Reels Creator helpers (JSON extraction, ASS color/time formatting).
 * Used by the unified `app/api/generate-reels/route.ts` and `lib/reels-pipeline/`.
 */
export { runReplicateWithRetry as runWithRetry } from "@/lib/replicate-server";

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
