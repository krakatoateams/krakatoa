import { createFalPhotoProvider, type FalQueueLike } from "./fal-photo";
import { GenerationCancelledError } from "./errors";
import {
  decodeFalPredictionId,
  encodeFalPredictionId,
  isTrustedFalOutputUrl,
  mapFalPhotoInput,
  normalizeFalOutput,
} from "./fal-photo-catalog";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`falPhotoSelfCheck: ${msg}`);
}

const replicateInput = {
  prompt: "p",
  resolution: "2K",
  image_input: ["https://x/a.png"],
  aspect_ratio: "4:5",
  google_search: false,
  image_search: false,
  allow_fallback_model: false,
  output_format: "png",
};

// Endpoint choice + field mapping.
const edit = mapFalPhotoInput("fal-ai/nano-banana-2", replicateInput);
assert(edit.endpoint === "fal-ai/nano-banana-2/edit", "refs pick the edit endpoint");
assert(JSON.stringify(edit.input.image_urls) === '["https://x/a.png"]' && !("image_input" in edit.input), "image_input -> image_urls");
assert(edit.input.resolution === "2K" && edit.input.aspect_ratio === "4:5", "resolution and ratio kept");
assert(!("google_search" in edit.input) && !("allow_fallback_model" in edit.input), "replicate-only fields dropped");
const t2i = mapFalPhotoInput("fal-ai/nano-banana-pro", { ...replicateInput, image_input: undefined });
assert(t2i.endpoint === "fal-ai/nano-banana-pro" && !("image_urls" in t2i.input), "no refs pick text-to-image");
assert(!("resolution" in mapFalPhotoInput("fal-ai/nano-banana", replicateInput).input), "basic has no resolution");
assert((() => { try { mapFalPhotoInput("fal-ai/other", {}); return false; } catch { return true; } })(), "unknown model rejected");

// Output normalization + host guard.
assert(normalizeFalOutput({ images: [{ url: "https://v3.fal.media/files/a.png" }] }) === "https://v3.fal.media/files/a.png", "parses images[0].url");
assert(!isTrustedFalOutputUrl("https://evil.com/a.png") && !isTrustedFalOutputUrl("https://fal.media.evil.com/a.png"), "untrusted hosts rejected");
assert(!isTrustedFalOutputUrl("http://v3.fal.media/a.png") && !isTrustedFalOutputUrl("https://169.254.169.254/"), "non-https and internal rejected");
assert((() => { try { normalizeFalOutput({ images: [{ url: "https://evil.com/a.png" }] }); return false; } catch { return true; } })(), "normalizer rejects untrusted output");
assert((() => { try { normalizeFalOutput({}); return false; } catch { return true; } })(), "missing images rejected");

// Prediction id round trip.
const id = encodeFalPredictionId("fal-ai/nano-banana/edit", "req-1");
const dec = decodeFalPredictionId(id);
assert(dec?.endpoint === "fal-ai/nano-banana/edit" && dec.requestId === "req-1" && decodeFalPredictionId("nope") === null, "id round trip");

async function main(): Promise<void> {
  const log: string[] = [];
  let polls = 0;
  const fake = (completeAfter: number, host = "https://v3.fal.media/f.png"): FalQueueLike => ({
    queue: {
      submit: async (e, o) => { log.push(`submit ${e} ${Object.keys(o.input).join(",")}`); return { request_id: "r1" }; },
      status: async () => ({ status: ++polls > completeAfter ? "COMPLETED" : "IN_PROGRESS" }),
      result: async () => ({ data: { images: [{ url: host }] } }),
      cancel: async (e, o) => { log.push(`cancel ${e} ${o.requestId}`); },
    },
    storage: { upload: async () => "https://v3.fal.media/up.png" },
  });

  const ticks: string[] = [];
  const ok = await createFalPhotoProvider(fake(2), 0).run({
    model: "fal-ai/nano-banana", input: replicateInput, hooks: { onPrediction: (t) => ticks.push(`${t.id}:${t.status}`) },
  });
  assert(ok === "https://v3.fal.media/f.png" && log[0].startsWith("submit fal-ai/nano-banana/edit"), "run returns the normalized url via the edit endpoint");
  assert(ticks[0] === "r1@fal-ai/nano-banana/edit:starting" && ticks.at(-1)!.endsWith(":succeeded"), "prediction ticks recorded with endpoint-bearing id");

  polls = 0; log.length = 0;
  let cancelled = false;
  try {
    await createFalPhotoProvider(fake(99), 0).run({
      model: "fal-ai/nano-banana", input: replicateInput, hooks: { abortCheck: async () => { throw new GenerationCancelledError(); } },
    });
  } catch (e) { cancelled = e instanceof GenerationCancelledError; }
  assert(cancelled && log.some((l) => l.startsWith("cancel fal-ai/nano-banana/edit r1")), "abort cancels the Fal request and rethrows");

  let rejected = false;
  try { await createFalPhotoProvider(fake(0, "https://evil.com/x.png"), 0).run({ model: "fal-ai/nano-banana", input: replicateInput }); } catch { rejected = true; }
  assert(rejected, "run rejects output from a non-allowlisted host");

  const res = await createFalPhotoProvider(fake(0), 0).cancelPredictions([id, "garbage"]);
  assert(res.requested === 2 && res.cancelled === 1, "cancel by recorded id, bad ids skipped");
  const p = createFalPhotoProvider(fake(0), 0);
  assert(p.commitsOnSubmit && p.id === "fal", "fal commits at submit");
  console.log("fal-photo-self-check: ok");
}
void main();
