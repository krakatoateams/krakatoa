/** Pure math for the timeline clip filmstrip (see useClipFilmstrip). */

/** Timeline row height in CSS px (`h-8`); tiles are this tall on screen. */
export const FILMSTRIP_ROW_PX = 32;
export const FILMSTRIP_MAX_FRAMES = 16;

/** How many tiles fill a clip block when each tile keeps the source aspect at row height. */
export function filmstripCount(blockWidthPx: number, sourceAspect: number): number {
  const aspect = Number.isFinite(sourceAspect) && sourceAspect > 0 ? sourceAspect : 16 / 9;
  const tile = FILMSTRIP_ROW_PX * aspect;
  const count = Math.ceil(Math.max(0, blockWidthPx) / tile);
  return Math.min(FILMSTRIP_MAX_FRAMES, Math.max(1, count));
}

/**
 * Evenly spaced source times (tile centers) across [inSec, outSec], snapped to 0.1 s
 * so nearby ranges share cache entries.
 */
export function filmstripTimes(inSec: number, outSec: number, count: number): number[] {
  const start = Math.max(0, inSec);
  const span = Math.max(0, outSec - start);
  const n = Math.max(1, Math.floor(count));
  return Array.from({ length: n }, (_, i) => Math.round((start + ((i + 0.5) * span) / n) * 10) / 10);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`editorFilmstripSelfCheck: ${msg}`);
}

export function editorFilmstripSelfCheck(): void {
  // 16:9 tile at 32 px is ~56.9 px wide.
  assert(filmstripCount(28, 16 / 9) === 1, "a minimum-width block gets one tile");
  assert(filmstripCount(120, 16 / 9) === 3, "120 px of 16:9 needs three tiles");
  assert(filmstripCount(120, 9 / 16) === 7, "portrait tiles are narrower, so more of them");
  assert(filmstripCount(100_000, 16 / 9) === FILMSTRIP_MAX_FRAMES, "count is capped");
  assert(filmstripCount(120, 0) === 3, "unknown aspect falls back to 16:9");
  assert(filmstripCount(0, 1) === 1, "never zero tiles");

  const times = filmstripTimes(2, 6, 4);
  assert(JSON.stringify(times) === JSON.stringify([2.5, 3.5, 4.5, 5.5]), "tile centers span the trimmed range");
  assert(times.every((t) => t >= 2 && t <= 6), "times stay inside [in, out]");
  assert(JSON.stringify(filmstripTimes(0, 1, 3)) === JSON.stringify([0.2, 0.5, 0.8]), "times snap to 0.1 s");
  assert(filmstripTimes(1, 1, 2).every((t) => t === 1), "an empty range collapses to the in-point");
}

if (require.main === module) {
  editorFilmstripSelfCheck();
  console.log("editorFilmstripSelfCheck: ok");
}
