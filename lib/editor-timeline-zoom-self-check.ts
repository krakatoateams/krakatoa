import {
  DEFAULT_PX_PER_SEC,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  anchoredScrollLeft,
  clampScale,
  OPEN_FIT_MAX_PX_PER_SEC,
  OPEN_FIT_MIN_PX_PER_SEC,
  fitPxPerSec,
  openFitPxPerSec,
  formatRulerLabel,
  rulerIntervalSec,
  stepScale,
  visibleTickRange,
} from "./editor-timeline-zoom";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`editorTimelineZoomSelfCheck: ${msg}`);
}

export function editorTimelineZoomSelfCheck(): void {
  assert(clampScale(1) === MIN_PX_PER_SEC && clampScale(9999) === MAX_PX_PER_SEC, "clamps to limits");
  assert(clampScale(NaN) === DEFAULT_PX_PER_SEC, "NaN falls back to default");
  assert(stepScale(64, 1) === 80 && stepScale(80, -1) === 64, "steps are multiplicative and reversible");
  assert(stepScale(MAX_PX_PER_SEC, 1) === MAX_PX_PER_SEC, "no zoom past max");
  assert(stepScale(MIN_PX_PER_SEC, -1) === MIN_PX_PER_SEC, "no zoom past min");

  // Time under the anchor stays put: t = (scroll + x - pad) / px.
  const before = (100 + 300 - 12) / 64;
  const next = anchoredScrollLeft(64, 128, 100, 300);
  assert(Math.abs((next + 300 - 12) / 128 - before) < 1e-9, "anchor time is preserved");
  assert(anchoredScrollLeft(64, 6, 0, 500) === 0, "scrollLeft never negative");

  assert(rulerIntervalSec(64) === 2 && rulerIntervalSec(600) === 0.2, "interval adapts to scale");
  assert(rulerIntervalSec(MIN_PX_PER_SEC) === 15, "wide intervals when zoomed out");
  assert(formatRulerLabel(0.5) === "0.5s" && formatRulerLabel(70) === "1m 10s" && formatRulerLabel(120) === "2m", "labels");
  assert(formatRulerLabel(0.30000000000000004) === "0.3s", "label float noise is removed");

  assert(fitPxPerSec(9.5, 1000) === 100, "fit fills width with margin");
  assert(fitPxPerSec(0.1, 1000) === MAX_PX_PER_SEC && fitPxPerSec(600, 100) === MIN_PX_PER_SEC, "fit is clamped");
  assert(fitPxPerSec(0, 500) === DEFAULT_PX_PER_SEC && fitPxPerSec(10, 0) === DEFAULT_PX_PER_SEC, "empty/zero width");

  assert(openFitPxPerSec(1, 1500) === OPEN_FIT_MAX_PX_PER_SEC, "very short project is not stretched past the open cap");
  assert(openFitPxPerSec(60, 300) === OPEN_FIT_MIN_PX_PER_SEC, "long project keeps a grabbable scale");
  assert(openFitPxPerSec(5.5, 600) === 100, "open fit uses the plain fit scale in range");
  assert(openFitPxPerSec(0, 800) === 64 && openFitPxPerSec(5, 0) === 64, "empty or unmeasured uses the default");

  const [a, b] = visibleTickRange(0, 1000, 100, 1, 500);
  assert(a === 0 && b === 5, "tick range capped by content width");
}

editorTimelineZoomSelfCheck();
