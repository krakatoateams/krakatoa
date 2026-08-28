import type { VideoAspectRatio } from "./video-models";

/**
 * Match a video frame to the shape of a source image, so animating a square photo
 * doesn't letterbox it into a vertical frame.
 *
 * Pure — no DOM, no model catalog lookup — so it stays runnable as a self-check
 * (`npx tsx lib/aspect-ratio-match.ts`), mirroring lib/animate-handoff.ts.
 */

/** "16:9" → "16/9" for CSS `aspect-ratio`. Falls back to "9/16" for adaptive. */
export function aspectRatioToCss(ratio: VideoAspectRatio): string {
  if (ratio === "adaptive") return "9/16";
  const [w, h] = ratio.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return "9/16";
  return `${w}/${h}`;
}

/** "16:9" → 1.777…; null for labels with no fixed shape, i.e. "adaptive". */
function ratioValue(label: string): number | null {
  const [w, h] = label.split(":").map(Number);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return w / h;
}

/**
 * Closest supported frame to a `width × height` image, or null when the image
 * size is unknown or no candidate has a fixed shape.
 *
 * Distance is measured in log space so shapes are compared by relative error:
 * a raw difference of ratios is asymmetric and would drag every ambiguous image
 * toward the portrait end of the list. Exact ties (a square image offered only
 * 16:9 and 9:16 — reciprocals, so equally far) resolve to the first candidate,
 * which follows the order in the model catalog.
 */
export function nearestAspectRatio(
  width: number,
  height: number,
  allowed: readonly VideoAspectRatio[]
): VideoAspectRatio | null {
  if (!(width > 0) || !(height > 0)) return null;
  const target = width / height;

  let best: VideoAspectRatio | null = null;
  let bestDistance = Infinity;
  for (const candidate of allowed) {
    const value = ratioValue(candidate);
    if (value === null) continue;
    const distance = Math.abs(Math.log(target / value));
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** Every ratio a Seedance model offers — the widest candidate set in the catalog. */
const SEEDANCE: readonly VideoAspectRatio[] = [
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
  "21:9",
  "9:21",
  "adaptive",
];

/** ponytail: runnable without a browser — fails if frame matching drifts. */
export function aspectRatioMatchSelfCheck(): void {
  assert(nearestAspectRatio(1024, 1024, SEEDANCE) === "1:1", "a square photo must map to 1:1");
  assert(nearestAspectRatio(1920, 1080, SEEDANCE) === "16:9", "1920x1080 must map to 16:9");
  assert(nearestAspectRatio(1080, 1920, SEEDANCE) === "9:16", "1080x1920 must map to 9:16");
  assert(nearestAspectRatio(2560, 1080, SEEDANCE) === "21:9", "an ultrawide photo must map to 21:9");
  assert(
    nearestAspectRatio(1080, 1350, SEEDANCE) === "3:4",
    "a 4:5 portrait photo must map to 3:4, the nearest offered shape"
  );

  // The caller measures a 64 px thumbnail, so the dimensions arrive rounded.
  assert(nearestAspectRatio(64, 64, SEEDANCE) === "1:1", "a 64px square thumbnail must map to 1:1");
  assert(nearestAspectRatio(64, 80, SEEDANCE) === "3:4", "a 64px 4:5 thumbnail must map to 3:4");
  assert(nearestAspectRatio(64, 114, SEEDANCE) === "9:16", "a 64px 9:16 thumbnail must map to 9:16");

  // "adaptive" carries no shape, so it can never be the match.
  assert(nearestAspectRatio(1024, 1024, ["adaptive"]) === null, "adaptive alone has no match");
  assert(
    nearestAspectRatio(1024, 1024, ["adaptive", "1:1"]) === "1:1",
    "adaptive must be skipped, not preferred"
  );

  // Veo-style catalogs offer no square frame.
  assert(
    nearestAspectRatio(1920, 1200, ["16:9", "9:16"]) === "16:9",
    "a landscape photo must stay landscape when only 16:9 and 9:16 exist"
  );
  assert(
    nearestAspectRatio(1024, 1024, ["16:9", "9:16"]) === "16:9",
    "a square photo is equally far from both, so catalog order decides"
  );

  assert(nearestAspectRatio(0, 1024, SEEDANCE) === null, "a zero dimension has no match");
  assert(nearestAspectRatio(1024, Number.NaN, SEEDANCE) === null, "NaN dimensions have no match");
  assert(nearestAspectRatio(1024, 1024, []) === null, "an empty catalog has no match");
}

if (require.main === module) {
  aspectRatioMatchSelfCheck();
  console.log("aspectRatioMatchSelfCheck: ok");
}
