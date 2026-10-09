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
 * Zoom-derived time step: the largest `2^k / 30` s that fits in one tile's time span
 * (`tileWidthPx / pxPerSec`), never finer than one 1/30 s frame. The ladder is nested, so
 * every coarse grid time is also a finer grid time and frames carry over between zoom levels.
 */
export function filmstripStepSec(pxPerSec: number, tileWidthPx: number): number {
  const spanSlots = (tileWidthPx / Math.max(1e-6, pxPerSec)) * FILMSTRIP_GRID_FPS;
  let step = 1;
  while (step * 2 <= spanSlots + 1e-9 && step < 2 ** 30) step *= 2;
  return step / FILMSTRIP_GRID_FPS;
}

/** Grid slot just at or after `sec` (tiny epsilon so float noise never skips a slot). */
function slotCeil(sec: number): number {
  return Math.ceil(sec * FILMSTRIP_GRID_FPS - 1e-6);
}

/** The value in [a, b] (non-negative integers) divisible by the largest power of two. */
function coarsestInRange(a: number, b: number): number {
  if (a <= 0 || a >= b) return Math.max(0, a);
  // a and b share every bit above `bit`; a has it clear, b has it set. If a's lower bits are
  // all zero, a itself is the coarsest value; otherwise it is b with the lower bits cleared.
  const bit = 31 - Math.clz32(a ^ b);
  const unit = 2 ** bit;
  return a % unit === 0 ? a : Math.floor(b / unit) * unit;
}

/**
 * 1/30 s source slot shown by tile `index`. Tile 0 is the frame at the in-point. Tile i >= 1
 * covers the source slots from its left edge (`inSec + i * tileWidthPx / pxPerSec`) up to the
 * next tile's left edge and shows the one on the coarsest ladder level in that span. That slot
 * is always a multiple of `filmstripStepSec`, lies on the absolute source timeline (moving a
 * clip never changes it), and zooming in or out keeps picking the same coarse slots, so most
 * frames are reused instead of reshuffled. Clamped to the frames covering [inSec, outSec].
 */
export function filmstripTileSlot(
  index: number,
  inSec: number,
  outSec: number,
  pxPerSec: number,
  tileWidthPx: number
): number {
  const start = Math.max(0, inSec);
  const inSlot = Math.floor(start * FILMSTRIP_GRID_FPS + 1e-6);
  const outSlot = Math.max(inSlot, Math.floor(Math.max(start, outSec) * FILMSTRIP_GRID_FPS + 1e-6));
  if (index <= 0) return inSlot;
  const spanSec = tileWidthPx / Math.max(1e-6, pxPerSec);
  const a = slotCeil(start + index * spanSec);
  const b = Math.max(a, slotCeil(start + (index + 1) * spanSec) - 1);
  if (a > outSlot) return outSlot;
  return Math.max(inSlot, coarsestInRange(a, Math.min(b, outSlot)));
}

/** Tile indices covering the viewport [viewLeft, viewRight] (block-local px). */
export function filmstripVisibleRange(
  count: number,
  tileWidth: number,
  viewLeft: number,
  viewRight: number
): [number, number] {
  const first = Math.min(count - 1, Math.max(0, Math.floor(viewLeft / tileWidth)));
  const last = Math.min(count - 1, Math.max(first, Math.floor(viewRight / tileWidth)));
  return [first, last];
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
  const tw = filmstripTileWidth(16 / 9);
  const ZOOMS = [6, 12, 32, 64, 128, 300, 600];
  const fps = FILMSTRIP_GRID_FPS;
  const slotsAt = (inSec: number, outSec: number, px: number) => {
    const n = filmstripCount(Math.max(28, (outSec - inSec) * px), 16 / 9);
    return Array.from({ length: n }, (_, i) => filmstripTileSlot(i, inSec, outSec, px, tw));
  };
  const inSec = 3.3;
  const outSec = 63.3;
  let prevCount = 0;
  let prevStep = Infinity;
  for (const px of ZOOMS) {
    const step = filmstripStepSec(px, tw);
    const stepSlots = Math.round(step * fps);
    assert(step <= prevStep, `step never grows with zoom (${px})`);
    assert(stepSlots >= 1 && (stepSlots & (stepSlots - 1)) === 0, `step is a 2^k/30 ladder value (${px})`);
    assert(step <= tw / px || stepSlots === 1, `step fits one tile span (${px})`);
    const slots = slotsAt(inSec, outSec, px);
    assert(slots.length >= prevCount, `tile count never drops when zooming in (${px})`);
    assert(slots[0] === Math.floor(inSec * fps), `tile 0 is the in-point frame (${px})`);
    assert(slots.every((s, i) => i === 0 || s > slots[i - 1]), `times increase left to right (${px})`);
    // The last tile's span may be cut by the out-point, so it can fall between step times.
    assert(slots.every((s, i) => i === 0 || i === slots.length - 1 || s % stepSlots === 0), `tile times sit on the step grid (${px})`);
    assert(slots.every((s) => s >= Math.floor(inSec * fps) && s <= Math.floor(outSec * fps)), `times stay in range (${px})`);
    assert(JSON.stringify(slotsAt(inSec, outSec, px)) === JSON.stringify(slots), `deterministic (${px})`);
    // One tile of trim: the remaining tiles keep their exact absolute frames.
    const trimmed = slotsAt(inSec + tw / px, outSec, px);
    assert(trimmed.slice(1).every((s, i) => s === slots[i + 2]), `trim by one tile keeps shared frames (${px})`);
    // A trim by one step moves every tile edge, but most frames are still ones already captured.
    const before = new Set(slots);
    const stepTrimmed = slotsAt(inSec + step, outSec, px);
    assert(stepTrimmed.filter((s) => before.has(s)).length * 2 >= stepTrimmed.length, `trim by one step reuses most frames (${px})`);
    prevCount = slots.length;
    prevStep = step;
  }
  const valuation = (v: number) => (v === 0 ? 99 : 31 - Math.clz32(v & -v));
  for (let a = 0; a < 140; a++) {
    for (let b = a; b < a + 70; b++) {
      const got = coarsestInRange(a, b);
      for (let v = a; v <= b; v++) assert(valuation(got) >= valuation(v) && got >= a && got <= b, `coarsest in [${a}, ${b}]`);
    }
  }
  // Nested across the listed zoom levels: every coarse frame is still shown one level finer.
  for (let k = 0; k + 1 < ZOOMS.length; k++) {
    const fine = new Set(slotsAt(inSec, outSec, ZOOMS[k + 1]));
    assert(slotsAt(inSec, outSec, ZOOMS[k]).every((s) => fine.has(s)), `nested ${ZOOMS[k]} -> ${ZOOMS[k + 1]} px/s`);
  }
  // Doubling the zoom splits every tile in two: each coarse frame is still shown at the finer level.
  for (const px of [6, 12, 24, 48, 96, 192, 384]) {
    const fine = new Set(slotsAt(inSec, outSec, px * 2));
    assert(slotsAt(inSec, outSec, px).every((s) => fine.has(s)), `coarse frames are reused at 2x zoom (${px})`);
  }
  // One zoom-button step (x1.25) keeps most frames.
  for (const px of [6, 20, 64, 250, 480]) {
    const before = new Set(slotsAt(inSec, outSec, px));
    const after = slotsAt(inSec, outSec, px * 1.25);
    assert(after.filter((s) => before.has(s)).length >= 0.8 * before.size, `a zoom step reuses most frames (${px})`);
  }

  assert(filmstripStepSec(600, tw) === 2 / fps, "600 px/s: 57 px spans ~2.85 frames, step 2 frames");
  assert(filmstripStepSec(100_000, tw) === 1 / fps, "step bottoms out at one frame");
  assert(filmstripTileSlot(0, 1, 1, 100, 57) === 30, "an empty range collapses to the in-point");
  assert(filmstripTileSlot(1, 1, 1.2, 64, 57) === 36, "a tile past the out-point clamps to it");
  assert(filmstripTileSlot(0, 2.5, 4, 64, 57) === filmstripTileSlot(0, 2.5, 9, 600, 57), "tile 0 ignores zoom");

  // A 1 hour clip at max zoom only produces the tiles near a 1200 px viewport.
  const longCount = filmstripCount(3600 * 600, 16 / 9);
  const [vf, vl] = filmstripVisibleRange(longCount, tw, 500_000 - 600, 500_000 + 1800);
  assert(longCount > 30_000 && vl - vf + 1 <= Math.ceil(2400 / tw) + 1, "visible tiles stay bounded");
  const [f0, l0] = filmstripVisibleRange(3, tw, -1000, -10);
  assert(f0 === 0 && l0 === 0, "a viewport left of the block clamps to tile 0");
}

if (require.main === module) {
  editorFilmstripSelfCheck();
  console.log("editorFilmstripSelfCheck: ok");
}
