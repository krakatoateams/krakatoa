import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveFalOnlyPhotoModel } from "./fal-only-photo-model";
import { isModelStateUnavailable } from "./model-state-unavailable";
import { eligibleTiersForFeature } from "./creation-features";
import { PRODUCT_PHOTO_TIERS } from "./product-photo";

// #467: a Fal-only Photo tier never falls back to Replicate; anything unusable is the retryable 503.
const KEY = "image_krea2_turbo";
const MODEL = "fal-ai/krea-2/turbo";
const row = { provider: "fal", model: MODEL, enabled: true };

function refused(state: Parameters<typeof resolveFalOnlyPhotoModel>[1], falConfigured: boolean): boolean {
  try {
    resolveFalOnlyPhotoModel(KEY, state, falConfigured);
    return false;
  } catch (e) {
    return isModelStateUnavailable(e);
  }
}

assert.deepEqual(resolveFalOnlyPhotoModel(KEY, { row }, true), { provider: "fal", model: MODEL, parameters: {} }, "normal fal row resolves to fal");
assert.deepEqual(resolveFalOnlyPhotoModel(KEY, { row: { ...row, parameters: { x: 1 } } as typeof row }, true).parameters, {}, "stored params never used");
assert.ok(refused({ row: undefined }, true), "fal row missing -> 503");
assert.ok(refused({ row: null }, true), "fal row null -> 503");
assert.ok(refused({ row: { ...row, enabled: false } }, true), "fal row off -> 503");
assert.ok(refused({ row }, false), "FAL_KEY absent -> 503");
assert.ok(refused(null, true), "model state read error -> 503");
assert.ok(refused({ row: { ...row, provider: "replicate" } }, true), "replicate row -> 503, a Fal id never reaches Replicate");
assert.ok(refused({ row: { ...row, model: "fal-ai/other" } }, true), "off-catalog fal model -> 503");
assert.ok(refused({ row: { ...row, model: "fal-ai/nano-banana" } }, true), "another tier's fal model -> 503");

// Wiring pins: the resolver branch, the route 503 before spend, and the reference refusal before spend.
const resolver = readFileSync(new URL("./model-resolver.ts", import.meta.url), "utf8");
const getPhoto = resolver.slice(resolver.indexOf("export async function getPhotoModel"));
assert.match(getPhoto, /if \(tier\.falOnly\) \{[\s\S]*?resolveFalOnlyPhotoModel\(/, "getPhotoModel routes Fal-only tiers to the no-fallback resolver");
assert.match(getPhoto, /fallback: \{ provider: REPLICATE, model: tier\.providerModel/, "other tiers keep the Replicate fallback");
const route = readFileSync(new URL("../app/api/generate-photo/route.ts", import.meta.url), "utf8");
const resolveAt = route.indexOf("photoModel = await getPhotoModel(modelTier)");
const spendAt = route.indexOf("beginMeteredAttempt(");
assert.ok(resolveAt > 0 && spendAt > resolveAt, "model resolved before the spend");
assert.match(route.slice(resolveAt, resolveAt + 300), /isModelStateUnavailable\(e\)\) return modelStateUnavailableResponse\(\)/, "resolver failure is the retryable 503");
const refAt = route.indexOf("else if (tier.rejectsReference && referenceFiles.length > 0)");
assert.ok(refAt > 0 && refAt < spendAt, "reference images on a Krea tier are refused before the spend");
const capAt = route.indexOf("tier.maxPromptChars && prompt.length > tier.maxPromptChars");
assert.ok(capAt > resolveAt && capAt < spendAt, "an over-long Krea prompt is refused before the spend");
// #474: every Krea tier refuses references and caps the prompt at fal's 5000 characters.
for (const id of ["krea2_turbo", "krea2_large", "krea2_medium"] as const) {
  const t = PRODUCT_PHOTO_TIERS.find((x) => x.id === id)!;
  assert.ok(t.rejectsReference === true && t.maxPromptChars === 5000 && !t.supportsReference && !t.offeredByDefault, `${id}: hidden, text-to-image, refuses references, prompt cap`);
  assert.equal(eligibleTiersForFeature("product").includes(id), false, `${id} not offered in Product try-on`);
}
assert.deepEqual(PRODUCT_PHOTO_TIERS.filter((t) => t.rejectsReference).map((t) => t.id), ["krea2_turbo", "krea2_large", "krea2_medium"], "only the Krea tiers refuse references");

// Text-to-image only: never offered where a reference is required.
assert.equal(eligibleTiersForFeature("product").includes("krea2_turbo"), false, "not offered in Product try-on");
assert.equal(PRODUCT_PHOTO_TIERS.find((t) => t.id === "krea2_turbo")?.offeredByDefault, false, "ships hidden");
console.log("fal-only-photo-model self-check passed");
