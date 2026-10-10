/** Pure helpers for the Video Editor timeline marquee (drag-to-select). */

export type MarqueeRect = { left: number; top: number; right: number; bottom: number };

export type MarqueeStrip = {
  id: string;
  startSec: number;
  endSec: number;
  /** Row bounds in timeline-content px. */
  top: number;
  bottom: number;
  locked: boolean;
};

/** Pointer travel (px) below which a press is a plain click, not a marquee. */
export const MARQUEE_THRESHOLD_PX = 4;

export function marqueeRect(x0: number, y0: number, x1: number, y1: number): MarqueeRect {
  return { left: Math.min(x0, x1), top: Math.min(y0, y1), right: Math.max(x0, x1), bottom: Math.max(y0, y1) };
}

/** Ids of unlocked strips whose time range x row bounds intersect the rect. */
export function marqueeHits(rect: MarqueeRect, strips: MarqueeStrip[], pxPerSec: number): string[] {
  return strips
    .filter(
      (s) =>
        !s.locked &&
        s.startSec * pxPerSec < rect.right &&
        s.endSec * pxPerSec > rect.left &&
        s.top < rect.bottom &&
        s.bottom > rect.top
    )
    .map((s) => s.id);
}

/** One shared time delta for a group move: no strip crosses 0 or maxEnd, offsets stay intact, starts stay on the 0.1s grid. */
export function groupMoveDelta(strips: { startSec: number; endSec: number }[], rawDelta: number, maxEnd: number): number {
  if (strips.length === 0) return 0;
  const lo = -Math.min(...strips.map((s) => s.startSec));
  const hi = maxEnd - Math.max(...strips.map((s) => s.endSec));
  const clamped = Math.max(lo, Math.min(hi, rawDelta));
  // Snap, then re-clamp: rounding must not push a strip past 0 or maxEnd.
  return Math.max(lo, Math.min(hi, Math.round(clamped * 10) / 10));
}
