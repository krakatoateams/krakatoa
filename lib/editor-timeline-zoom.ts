/** Pure math for Video Editor timeline zoom. Zoom only changes the UI time-to-pixel scale. */

export const DEFAULT_PX_PER_SEC = 64;
/** 60 s (EDITOR_MAX_DURATION_SEC) still fills a phone-width scroller at this scale. */
export const MIN_PX_PER_SEC = 6;
/** About 18 px per frame at 30 fps. */
export const MAX_PX_PER_SEC = 600;
/** Multiplicative step so every zoom step feels equal. */
export const ZOOM_STEP = 1.25;
/** Horizontal padding (`px-3`) on each side of the timeline scroller. */
export const TIMELINE_PAD_PX = 12;
/** Fraction of the project length kept free at the right edge when fitting. */
export const FIT_MARGIN = 0.04;

const RULER_INTERVALS_SEC = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
const MIN_LABEL_GAP_PX = 70;

export function clampScale(px: number): number {
  if (!Number.isFinite(px)) return DEFAULT_PX_PER_SEC;
  return Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, px));
}

export function stepScale(px: number, direction: 1 | -1): number {
  return clampScale(direction > 0 ? px * ZOOM_STEP : px / ZOOM_STEP);
}

/** Scale that makes `durationSec` plus a small margin fill `availableWidthPx`. */
export function fitPxPerSec(durationSec: number, availableWidthPx: number): number {
  if (!(durationSec > 0) || !(availableWidthPx > 0)) return DEFAULT_PX_PER_SEC;
  return clampScale(availableWidthPx / (durationSec * (1 + FIT_MARGIN)));
}

/**
 * New scrollLeft that keeps the time under viewport x `anchorX` fixed when the scale
 * changes from `oldPx` to `newPx`.
 */
export function anchoredScrollLeft(
  oldPx: number,
  newPx: number,
  scrollLeft: number,
  anchorX: number,
  padPx = TIMELINE_PAD_PX
): number {
  const anchorSec = (scrollLeft + anchorX - padPx) / oldPx;
  return Math.max(0, anchorSec * newPx + padPx - anchorX);
}

/** Smallest tick interval whose labels stay at least ~70 px apart. */
export function rulerIntervalSec(px: number): number {
  return (
    RULER_INTERVALS_SEC.find((interval) => interval * px >= MIN_LABEL_GAP_PX) ??
    RULER_INTERVALS_SEC[RULER_INTERVALS_SEC.length - 1]
  );
}

export function formatRulerLabel(sec: number): string {
  const r = Math.round(sec * 10) / 10;
  if (r < 60) return `${r}s`;
  const m = Math.floor(r / 60);
  const s = Math.round((r - m * 60) * 10) / 10;
  return s ? `${m}m ${s}s` : `${m}m`;
}

/** Inclusive tick index range covering [startPx, endPx] (content coordinates). */
export function visibleTickRange(
  startPx: number,
  endPx: number,
  px: number,
  intervalSec: number,
  maxPx: number
): [number, number] {
  const stride = intervalSec * px;
  return [
    Math.max(0, Math.floor(startPx / stride)),
    Math.floor(Math.min(maxPx, Math.max(0, endPx)) / stride),
  ];
}
