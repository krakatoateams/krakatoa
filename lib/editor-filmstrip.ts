/** Pure math for the timeline clip filmstrip (see useClipFilmstrip). */

/** Timeline row height in CSS px (`h-8`); tiles are this tall on screen. */
export const FILMSTRIP_ROW_PX = 32;
/** Frame grid for tile times and cache keys (about one frame at 30 fps). */
export const FILMSTRIP_GRID_FPS = 30;

function safeAspect(sourceAspect: number): number {
  return Number.isFinite(sourceAspect) && sourceAspect > 0 ? sourceAspect : 16 / 9;
}

/** Integer CSS width of one tile at row height, so tiles butt together without sub-pixel gaps. */
export function filmstripTileWidth(sourceAspect: number): number {
  return Math.max(1, Math.round(FILMSTRIP_ROW_PX * safeAspect(sourceAspect)));
}

/** How many fixed-width tiles cover a clip block; the last one is clipped by the block. */
export function filmstripCount(blockWidthPx: number, sourceAspect: number): number {
  return Math.max(1, Math.ceil(Math.max(0, blockWidthPx) / filmstripTileWidth(sourceAspect)));
}

/**
 * Source time at the center of tile `index`'s visible range, mapped across [inSec, outSec]
 * and snapped to the frame grid (finer than one tile's time span at any supported zoom).
 */
export function filmstripTileTime(
  index: number,
  inSec: number,
  outSec: number,
  blockWidthPx: number,
  tileWidthPx: number
): number {
  const start = Math.max(0, inSec);
  const end = Math.max(start, outSec);
  const width = Math.max(1, blockWidthPx);
  const left = index * tileWidthPx;
  const center = (left + Math.min(left + tileWidthPx, width)) / 2;
  const t = start + (Math.min(center, width) / width) * (end - start);
  return Math.min(end, Math.max(start, Math.round(t * FILMSTRIP_GRID_FPS) / FILMSTRIP_GRID_FPS));
}

/** Grid slot used in cache keys for a snapped source time. */
export function filmstripGridIndex(sec: number): number {
  return Math.round(sec * FILMSTRIP_GRID_FPS);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`editorFilmstripSelfCheck: ${msg}`);
}

export function editorFilmstripSelfCheck(): void {
  // 16:9 tile at 32 px is 57 px wide.
  assert(filmstripTileWidth(16 / 9) === 57, "tile width is an integer");
  assert(filmstripCount(28, 16 / 9) === 1, "a minimum-width block gets one tile");
  assert(filmstripCount(120, 16 / 9) === 3, "120 px of 16:9 needs three tiles");
  assert(filmstripCount(120, 9 / 16) === 7, "portrait tiles are narrower, so more of them");
  assert(filmstripCount(36_000, 16 / 9) === 632, "count is not capped");
  assert(filmstripCount(120, 0) === 3, "unknown aspect falls back to 16:9");
  assert(filmstripCount(0, 1) === 1, "never zero tiles");

  // A 1 s clip at max zoom (600 px/s) shows a distinct frame per tile, all inside the range.
  const tw = filmstripTileWidth(16 / 9);
  const n = filmstripCount(600, 16 / 9);
  const times = Array.from({ length: n }, (_, i) => filmstripTileTime(i, 2, 3, 600, tw));
  assert(new Set(times).size === n, "adjacent tiles never share a frame");
  assert(times.every((t) => t >= 2 && t <= 3), "times stay inside [in, out]");
  assert(times.every((t, i) => i === 0 || t > times[i - 1]), "times increase left to right");
  assert(filmstripTileTime(0, 0, 10, 600, 60) === 0.5, "first tile is centered in its range");
  assert(filmstripTileTime(0, 1, 1, 100, 57) === 1, "an empty range collapses to the in-point");
  assert(filmstripGridIndex(1.5) === 45, "grid index is the 30 fps slot");
}

if (require.main === module) {
  editorFilmstripSelfCheck();
  console.log("editorFilmstripSelfCheck: ok");
}
