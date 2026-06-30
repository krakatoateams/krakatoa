export type VideoFormat = "short" | "video";

/** YouTube Shorts cap (current limit is 3 minutes). */
export const SHORT_MAX_SECONDS = 180;

/**
 * Auto-suggest the publish format from metadata: a vertical clip no longer
 * than the Shorts cap suggests "short"; landscape OR longer suggests "video".
 * Unknown aspect falls back to duration alone (so a short, dimensionless clip
 * still suggests "short").
 */
export function suggestFormat(
  durationSec: number | null,
  aspect: { w: number; h: number } | null,
): VideoFormat {
  const isPortrait = aspect ? aspect.h > aspect.w : true;
  const withinShort = durationSec === null || durationSec <= SHORT_MAX_SECONDS;
  return isPortrait && withinShort ? "short" : "video";
}

/**
 * Compute the scheduler publish format from a known aspect-ratio string
 * (e.g. "9:16", "16:9") and a duration in seconds. Returns null when the
 * ratio is "adaptive", unparseable, or otherwise unknown — the caller should
 * omit the &format= param and let the scheduler auto-detect after video load.
 */
export function formatFromAspectRatioString(
  aspectRatio: string,
  durationSec: number | null,
): VideoFormat | null {
  const parts = aspectRatio.split(":");
  if (parts.length !== 2) return null;
  const w = Number(parts[0]);
  const h = Number(parts[1]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return suggestFormat(durationSec, { w, h });
}
