import { ApiError } from "@fal-ai/client";
import { createFalPhotoProvider, type FalQueueLike } from "./fal-photo";
import {
  decodeFalPredictionId,
  encodeFalPredictionId,
  FAL_GPT_IMAGE_SIZES,
  FAL_KREA_MAX_PIXELS,
  FAL_KREA_MAX_PROMPT_CHARS,
  FAL_KREA_SIZES,
  isTrustedFalOutputUrl,
  isValidFalCustomSize,
  mapFalPhotoInput,
  normalizeFalOutput,
} from "./fal-photo-catalog";
import { buildPhotoProviderInput, getProductPhotoTier, photoAspectRatioOptionsForTier } from "../product-photo";

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

// Krea 2 Turbo (#467): text-to-image only, every offered ratio pinned to <= 1 MP (priced per MP).
const KREA = "fal-ai/krea-2/turbo";
const kreaTier = getProductPhotoTier("krea2_turbo");
assert(kreaTier.falOnly === true && kreaTier.supportsReference === false && kreaTier.providerModel === KREA, "krea tier is Fal-only text-to-image");
for (const size of Object.values(FAL_KREA_SIZES)) {
  assert(size.width * size.height <= FAL_KREA_MAX_PIXELS && size.width % 16 === 0 && size.height % 16 === 0, `krea size ${size.width}x${size.height} <= 1 MP, multiple of 16`);
}
for (const ratio of photoAspectRatioOptionsForTier(kreaTier)) {
  const built = buildPhotoProviderInput({ tier: kreaTier, prompt: "p", aspectRatio: ratio.id, imageInput: ["https://x/a.png"], providerResolution: null });
  const mapped = mapFalPhotoInput(KREA, built);
  assert(mapped.endpoint === KREA && JSON.stringify(mapped.input.image_size) === JSON.stringify(FAL_KREA_SIZES[ratio.id]), `krea ${ratio.id} maps to its pinned size`);
}
const kreaCall = mapFalPhotoInput(KREA, { prompt: "p", aspect_ratio: "1:1", output_format: "png" });
assert(
  JSON.stringify(kreaCall.input) ===
    JSON.stringify({ prompt: "p", image_size: { width: 992, height: 992 }, num_images: 1, acceleration: "none", enable_prompt_expansion: false, enable_safety_checker: true, output_format: "png", sync_mode: false }),
  "krea input is an allowlist with pinned count, acceleration, expansion, safety and sync_mode",
);
for (const ref of [{ image_input: ["https://x/a.png"] }, { input_images: ["https://x/a.png"] }, { input_image: "https://x/a.png" }]) {
  assert((() => { try { mapFalPhotoInput(KREA, { prompt: "p", aspect_ratio: "1:1", ...ref }); return false; } catch { return true; } })(), `krea rejects ${Object.keys(ref)[0]}`);
}
assert((() => { try { mapFalPhotoInput(KREA, { prompt: "p", aspect_ratio: "5:4" }); return false; } catch { return true; } })(), "krea rejects an unpinned ratio");

// Krea 2 Large / Medium (#474): second provider of Replicate tiers; aspect_ratio enum, flat per-image price.
for (const [endpoint, tierId] of [["krea/v2/large/text-to-image", "krea2_large"], ["krea/v2/medium/text-to-image", "krea2_medium"]] as const) {
  const tier = getProductPhotoTier(tierId);
  assert(!tier.falOnly && tier.providerFamily === "krea_v2" && tier.limitAspectRatioPicker === true, `${tierId} runs on Replicate by default`);
  for (const ratio of photoAspectRatioOptionsForTier(tier)) {
    const built = buildPhotoProviderInput({ tier, prompt: "p", aspectRatio: ratio.id, imageInput: ["https://x/a.png"], providerResolution: null });
    assert(JSON.stringify(built) === JSON.stringify({ prompt: "p", aspect_ratio: ratio.id, creativity: "medium" }), `${tierId} ${ratio.id}: Replicate allowlist, reference dropped`);
    const mapped = mapFalPhotoInput(endpoint, built);
    assert(
      mapped.endpoint === endpoint &&
        JSON.stringify(mapped.input) === JSON.stringify({ prompt: "p", aspect_ratio: ratio.id, creativity: "medium", enable_safety_checker: true }),
      `${tierId} ${ratio.id}: fal allowlist (no styles, moodboards or style references)`,
    );
  }
  assert(photoAspectRatioOptionsForTier(tier).map((r) => r.id).join() === "1:1,4:5,2:3,9:16,3:2,4:3,16:9", `${tierId} offers exactly the provider's ratios`);
  assert(buildPhotoProviderInput({ tier, prompt: "p", aspectRatio: "3:4", providerResolution: null }).aspect_ratio === "4:5", `${tierId} clamps 3:4 to the nearest ratio`);
  assert(tier.fixedResolutionLabel === undefined, `${tierId} shows no unverified resolution chip`);
  assert(buildPhotoProviderInput({ tier, prompt: "p", aspectRatio: "21:9", providerResolution: null }).aspect_ratio === "16:9", `${tierId} clamps 21:9`);
  for (const ref of [{ image_input: ["https://x/a.png"] }, { input_images: ["https://x/a.png"] }, { input_image: "https://x/a.png" }]) {
    assert((() => { try { mapFalPhotoInput(endpoint, { prompt: "p", aspect_ratio: "1:1", ...ref }); return false; } catch { return true; } })(), `${tierId} rejects ${Object.keys(ref)[0]}`);
  }
  assert((() => { try { mapFalPhotoInput(endpoint, { prompt: "x".repeat(FAL_KREA_MAX_PROMPT_CHARS + 1), aspect_ratio: "1:1" }); return false; } catch { return true; } })(), `${tierId} rejects a prompt over fal's cap`);
  assert((() => { try { mapFalPhotoInput(endpoint, { prompt: "p", aspect_ratio: "21:9" }); return false; } catch { return true; } })(), `${tierId} rejects a ratio fal lacks`);
}
assert((() => { try { mapFalPhotoInput(KREA, { prompt: "x".repeat(FAL_KREA_MAX_PROMPT_CHARS + 1), aspect_ratio: "1:1" }); return false; } catch { return true; } })(), "krea rejects a prompt over fal's cap");
assert(FAL_KREA_MAX_PROMPT_CHARS === 5000 && mapFalPhotoInput(KREA, { prompt: "x".repeat(5000), aspect_ratio: "1:1" }).endpoint === KREA, "krea accepts a prompt at the cap");

// GPT Image 2.5 Flare on Fal.
const FLARE = "openai/gpt-image-2.5/flare/text-to-image";
const flareIn = { prompt: "p", aspect_ratio: "3:2", quality: "low", output_format: "png", number_of_images: 1, background: "opaque", moderation: "auto" };
const flareT2i = mapFalPhotoInput(FLARE, flareIn);
assert(flareT2i.endpoint === FLARE && !("image_urls" in flareT2i.input), "flare t2i endpoint");
assert(JSON.stringify(flareT2i.input) === JSON.stringify({ prompt: "p", image_size: { width: 1248, height: 832 }, quality: "low", background: "opaque", output_format: "png", num_images: 1 }), "flare t2i fields (no aspect_ratio/moderation, num_images 1)");
const flareEdit = mapFalPhotoInput(FLARE, { ...flareIn, aspect_ratio: "1:1", quality: "high", input_images: ["https://x/a.png", "https://x/b.png"] });
assert(flareEdit.endpoint === "openai/gpt-image-2.5/flare/edit" && flareEdit.input.image_size === "square_hd" && flareEdit.input.quality === "high", "flare edit endpoint, preset, quality");
assert(JSON.stringify(flareEdit.input.image_urls) === '["https://x/a.png","https://x/b.png"]' && !("input_images" in flareEdit.input), "input_images -> image_urls, order kept");
for (const q of ["low", "medium", "high"]) assert(mapFalPhotoInput(FLARE, { ...flareIn, quality: q }).input.quality === q, `quality ${q} passes through`);
for (const bad of [undefined, "auto", "xhigh"]) assert((() => { try { mapFalPhotoInput(FLARE, { ...flareIn, quality: bad }); return false; } catch { return true; } })(), `quality ${String(bad)} rejected`);
assert((() => { try { mapFalPhotoInput(FLARE, { ...flareIn, aspect_ratio: "5:1" }); return false; } catch { return true; } })(), "unknown ratio rejected");
// Every Photo picker ratio maps to a valid size.
for (const r of ["1:1", "4:5", "3:4", "2:3", "9:16", "3:2", "4:3", "16:9", "21:9"]) {
  const sz = FAL_GPT_IMAGE_SIZES[r];
  assert(sz !== undefined, `ratio ${r} mapped`);
  if (typeof sz !== "string") {
    const [w, h] = r.split(":").map(Number);
    assert(isValidFalCustomSize(sz.width, sz.height), `ratio ${r} custom size within fal limits`);
    assert(Math.abs(sz.width / sz.height - w / h) < 0.01, `ratio ${r} custom size keeps the shape`);
  }
}
assert(!isValidFalCustomSize(1000, 1000) && !isValidFalCustomSize(4000, 1024) && !isValidFalCustomSize(2304, 640), "size validator rejects bad sizes");

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
      cancel: async (e, o) => { log.push(`cancel ${e} ${o.requestId}`); return "removed"; },
    },
    storage: { upload: async () => "https://v3.fal.media/up.png" },
  });

  const ticks: string[] = [];
  const ok = await createFalPhotoProvider(fake(2), 0).run({
    model: "fal-ai/nano-banana", input: replicateInput, hooks: { onPrediction: (t) => ticks.push(`${t.id}:${t.status}`) },
  });
  assert(ok === "https://v3.fal.media/f.png" && log[0].startsWith("submit fal-ai/nano-banana/edit"), "run returns the normalized url via the edit endpoint");
  assert(ticks[0] === "r1@fal-ai/nano-banana/edit:starting" && ticks.at(-1)!.endsWith(":succeeded"), "prediction ticks recorded with endpoint-bearing id");

  let rejected = false;
  try { await createFalPhotoProvider(fake(0, "https://evil.com/x.png"), 0).run({ model: "fal-ai/nano-banana", input: replicateInput }); } catch { rejected = true; }
  assert(rejected, "run rejects output from a non-allowlisted host");

  const res = await createFalPhotoProvider(fake(0), 0).cancelPredictions([id, "garbage"]);
  assert(res.requested === 2 && res.cancelled === 1, "cancel by recorded id, bad ids skipped");
  const p = createFalPhotoProvider(fake(0), 0);
  assert(p.commitsOnSubmit && p.cancelWhileQueued && p.id === "fal", "fal: ambiguous after submit, cancellable while queued");
  // Reconcile status: an expired result (404) is ambiguous (the run may have delivered), a 422 result is failed.
  const withResult = (status: number): FalQueueLike => ({
    ...fake(0),
    queue: { ...fake(0).queue, result: async () => { throw new ApiError({ message: "x", status, body: {} }); } },
  });
  const statusOf = (s: number) => createFalPhotoProvider(withResult(s), 0).getPredictionStatus(id).then((r) => r.status, () => "threw");
  assert((await statusOf(404)) === "threw", "expired result (404) stays ambiguous: no refund");
  assert((await statusOf(422)) === "failed", "4xx result stays definitive failed");
  assert((await statusOf(500)) === "threw", "5xx stays ambiguous");
  console.log("fal-photo-self-check: ok");
}
void main();
