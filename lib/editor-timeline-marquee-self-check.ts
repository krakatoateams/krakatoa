import assert from "node:assert/strict";
import { marqueeHits, marqueeRect, type MarqueeStrip } from "./editor-timeline-marquee";

const strips: MarqueeStrip[] = [
  { id: "a", startSec: 0, endSec: 2, top: 0, bottom: 44, locked: false },
  { id: "b", startSec: 4, endSec: 6, top: 0, bottom: 44, locked: false },
  { id: "c", startSec: 0, endSec: 6, top: 48, bottom: 92, locked: false },
  { id: "d", startSec: 0, endSec: 6, top: 0, bottom: 44, locked: true },
];
const hit = (x0: number, y0: number, x1: number, y1: number, px: number) =>
  marqueeHits(marqueeRect(x0, y0, x1, y1), strips, px).join(",");

assert.deepEqual(marqueeRect(150, 30, 20, 10), { left: 20, top: 10, right: 150, bottom: 30 });
assert.equal(hit(10, 10, 60, 30, 50), "a", "touches a only; locked d skipped");
assert.equal(hit(10, 10, 300, 90, 50), "a,b,c", "spans rows");
assert.equal(hit(110, 10, 150, 30, 50), "", "gap between strips");
assert.equal(hit(10, 10, 50, 30, 10), "a,b", "zoom-out: 10px/s puts a and b within reach");
assert.equal(hit(10, 50, 20, 60, 50), "c", "single row below");
console.log("editor-timeline-marquee self-check ok");
