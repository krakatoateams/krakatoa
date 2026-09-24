/**
 * Pure zoom/pan math for the Video Editor preview viewport. Zoom is a
 * percentage of the "fit" size (the contain-sized box from
 * `containSize()` in editor-preview-size.ts) — 100% always shows the
 * whole canvas, matching the Fit/Reset behavior.
 *
 * Pure — no DOM — so it stays runnable as a self-check
 * (`npx tsx lib/editor-viewport.ts`), mirroring lib/editor-preview-size.ts.
 */

export const EDITOR_VIEWPORT_ZOOM_MIN = 25;
export const EDITOR_VIEWPORT_ZOOM_MAX = 400;
export const EDITOR_VIEWPORT_ZOOM_STEP = 25;
export const EDITOR_VIEWPORT_ZOOM_FIT = 100;

export type ViewportPan = { x: number; y: number };
export type ViewportSize = { width: number; height: number };
export type StageSize = { w: number; h: number };

export function clampZoomPercent(percent: number): number {
  if (!Number.isFinite(percent)) return EDITOR_VIEWPORT_ZOOM_FIT;
  return Math.min(EDITOR_VIEWPORT_ZOOM_MAX, Math.max(EDITOR_VIEWPORT_ZOOM_MIN, percent));
}

/** Button/keyboard zoom: steps to the nearest clean multiple of the step size. */
export function stepZoomPercent(percent: number, direction: 1 | -1): number {
  const stepped = Math.round(percent / EDITOR_VIEWPORT_ZOOM_STEP) * EDITOR_VIEWPORT_ZOOM_STEP;
  return clampZoomPercent(stepped + direction * EDITOR_VIEWPORT_ZOOM_STEP);
}

/** Wheel/pinch zoom: continuous, exponential so equal-sized gestures feel equal at any zoom level. */
export function zoomPercentFromWheel(percent: number, deltaY: number): number {
  const factor = Math.exp(-deltaY * 0.0015);
  return clampZoomPercent(percent * factor);
}

/** Pinch zoom: ratio of current to starting touch distance, applied to the starting zoom. */
export function zoomPercentFromPinch(startPercent: number, distanceRatio: number): number {
  if (!(distanceRatio > 0)) return startPercent;
  return clampZoomPercent(startPercent * distanceRatio);
}

/**
 * Keeps the content under `point` (stage px, relative to stage center) fixed
 * on screen while the zoom changes from `oldZoomPercent` to `newZoomPercent`.
 */
export function panForZoomAtPoint(
  pan: ViewportPan,
  oldZoomPercent: number,
  newZoomPercent: number,
  point: ViewportPan
): ViewportPan {
  if (!(oldZoomPercent > 0)) return pan;
  const ratio = newZoomPercent / oldZoomPercent;
  return {
    x: point.x - (point.x - pan.x) * ratio,
    y: point.y - (point.y - pan.y) * ratio,
  };
}

/**
 * Clamps pan so the zoomed canvas can never fully leave the stage. Each axis
 * can pan until that edge of the canvas reaches the matching stage edge, with
 * a floor of half the stage size — so panning stays available even when the
 * canvas is smaller than (or equal to) the stage, e.g. at Fit zoom.
 */
export function clampPan(pan: ViewportPan, displaySize: ViewportSize, stage: StageSize): ViewportPan {
  const maxX = Math.max(stage.w / 2, (displaySize.width - stage.w) / 2);
  const maxY = Math.max(stage.h / 2, (displaySize.height - stage.h) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, pan.x)),
    y: Math.min(maxY, Math.max(-maxY, pan.y)),
  };
}

export function isFitViewport(zoomPercent: number, pan: ViewportPan): boolean {
  return zoomPercent === EDITOR_VIEWPORT_ZOOM_FIT && pan.x === 0 && pan.y === 0;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export function editorViewportSelfCheck(): void {
  // Clamp keeps zoom inside [MIN, MAX] and falls back to Fit for bad input.
  assert(clampZoomPercent(10) === EDITOR_VIEWPORT_ZOOM_MIN, "clamps below min");
  assert(clampZoomPercent(1000) === EDITOR_VIEWPORT_ZOOM_MAX, "clamps above max");
  assert(clampZoomPercent(Number.NaN) === EDITOR_VIEWPORT_ZOOM_FIT, "NaN falls back to fit");

  // Button zoom always lands on a clean step and can't cross the bounds.
  assert(stepZoomPercent(100, 1) === 125, "zoom in steps by STEP");
  assert(stepZoomPercent(100, -1) === 75, "zoom out steps by STEP");
  assert(stepZoomPercent(EDITOR_VIEWPORT_ZOOM_MAX, 1) === EDITOR_VIEWPORT_ZOOM_MAX, "zoom in clamps at max");
  assert(stepZoomPercent(EDITOR_VIEWPORT_ZOOM_MIN, -1) === EDITOR_VIEWPORT_ZOOM_MIN, "zoom out clamps at min");
  assert(stepZoomPercent(110, 1) === 125, "off-step values round to the nearest step first");

  // Wheel zoom in/out moves the percent the expected direction and stays clamped.
  assert(zoomPercentFromWheel(100, -100) > 100, "negative deltaY (scroll up) zooms in");
  assert(zoomPercentFromWheel(100, 100) < 100, "positive deltaY (scroll down) zooms out");
  assert(zoomPercentFromWheel(EDITOR_VIEWPORT_ZOOM_MAX, -1000) === EDITOR_VIEWPORT_ZOOM_MAX, "wheel zoom clamps at max");
  assert(zoomPercentFromWheel(EDITOR_VIEWPORT_ZOOM_MIN, 1000) === EDITOR_VIEWPORT_ZOOM_MIN, "wheel zoom clamps at min");

  // Pinch zoom scales the starting percent by the distance ratio.
  assert(zoomPercentFromPinch(100, 2) === 200, "pinch out doubles zoom");
  assert(zoomPercentFromPinch(100, 0.5) === 50, "pinch in halves zoom");
  assert(zoomPercentFromPinch(100, 0) === 100, "a zero/invalid ratio is a no-op");

  // Zooming toward a point keeps that point fixed on screen.
  {
    const point = { x: 40, y: -20 };
    const pan0 = { x: 0, y: 0 };
    const pan1 = panForZoomAtPoint(pan0, 100, 200, point);
    // The content point under the cursor before zoom: (point - pan0) / (100/100) = point.
    // After zoom, the same content point must render back under `point`:
    // point == pan1 + point * (200/100)  =>  pan1 == point - point*2 == -point
    assert(pan1.x === -point.x && pan1.y === -point.y, "zoom-at-point keeps the point fixed on screen");
    // Zooming back to the original percent from the same point restores the original pan.
    const pan2 = panForZoomAtPoint(pan1, 200, 100, point);
    assert(Math.abs(pan2.x - pan0.x) < 1e-9 && Math.abs(pan2.y - pan0.y) < 1e-9, "zoom is reversible at the same point");
  }

  // Pan clamp: a fit-or-smaller canvas can still pan, up to half the stage size.
  {
    const clamped = clampPan({ x: 999, y: -999 }, { width: 400, height: 300 }, { w: 800, h: 600 });
    assert(clamped.x === 400 && clamped.y === -300, "a fit-or-smaller canvas can pan up to half the stage size");
  }

  // Pan clamp: an oversized canvas can pan until its edge reaches the stage edge, no further.
  {
    const displaySize = { width: 1600, height: 1200 };
    const stage = { w: 800, h: 600 };
    const maxX = (displaySize.width - stage.w) / 2;
    const maxY = (displaySize.height - stage.h) / 2;
    const clamped = clampPan({ x: 10_000, y: -10_000 }, displaySize, stage);
    assert(clamped.x === maxX, "pan clamps to the positive limit");
    assert(clamped.y === -maxY, "pan clamps to the negative limit");
    const inBounds = clampPan({ x: 10, y: -10 }, displaySize, stage);
    assert(inBounds.x === 10 && inBounds.y === -10, "in-bounds pan passes through unchanged");
  }

  // isFitViewport only reports true at exactly 100% with no pan.
  assert(isFitViewport(100, { x: 0, y: 0 }), "100% + no pan is fit");
  assert(!isFitViewport(125, { x: 0, y: 0 }), "non-100% zoom is not fit");
  assert(!isFitViewport(100, { x: 1, y: 0 }), "any pan offset is not fit");
}

if (require.main === module) {
  editorViewportSelfCheck();
  console.log("editorViewportSelfCheck: ok");
}
