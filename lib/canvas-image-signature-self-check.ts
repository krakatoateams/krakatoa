import { canvasImageAttemptSignature } from "./canvas-image-signature";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`canvas-image-signature self-check: ${message}`);
}

const base = {
  prompt: "a red shoe",
  modelTier: "pro",
  aspectRatio: "1:1",
  resolution: "2k",
  quality: "high",
  refImageIds: ["a", "b"],
  resolvedRefFrameCount: 2,
};
const sig = (patch: Partial<typeof base> = {}) =>
  canvasImageAttemptSignature({ ...base, ...patch });

assert(sig() === sig(), "identical requests share a signature");
const variants: Array<[string, Partial<typeof base>]> = [
  ["effective model", { modelTier: "fast" }],
  ["quality", { quality: "low" }],
  ["resolution", { resolution: "4k" }],
  ["aspect ratio", { aspectRatio: "16:9" }],
  ["prompt", { prompt: "a blue shoe" }],
  ["reference list", { refImageIds: ["a"] }],
  ["resolved frame count", { resolvedRefFrameCount: 1 }],
];
for (const [name, patch] of variants) {
  assert(sig(patch) !== sig(), `${name} changes the signature`);
}

console.log("canvas-image-signature self-check ok");
