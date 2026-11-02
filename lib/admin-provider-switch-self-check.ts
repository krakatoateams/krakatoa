import assert from "node:assert/strict";
import { calculateCredits, DEFAULT_BILLING_SETTINGS } from "./pricing-math";
import { V2_PRICING_DEFAULTS } from "./pricing-defaults";
import { isSupportedProviderModel } from "./ai-provider-catalog";
import { getModelDefault, getPricingDefault } from "./admin-config-resolved-defaults";
import { PRODUCT_PHOTO_TIERS } from "./product-photo";
import { activePhotoProvider, isFalOnlyPhotoRole, marginForCost, photoPatchUnit, photoProviderOptions, photoSwitchTarget, providerCostKey, providerMargins } from "./admin-provider-switch";

const FAL_TIERS = ["image_basic", "image_balanced", "image_pro", "image_gpt_image_2", "image_krea2_large", "image_krea2_medium"];
// #467: Fal-only tiers (no Replicate equivalent) offer only fal and reset to fal.
const FAL_ONLY_TIERS = ["image_krea2_turbo"];
assert.deepEqual(PRODUCT_PHOTO_TIERS.filter((t) => t.falOnly).map((t) => t.modelRole), FAL_ONLY_TIERS);
for (const tier of PRODUCT_PHOTO_TIERS) {
  const providers = photoProviderOptions(tier.modelRole).map((o) => o.provider);
  const falOnly = FAL_ONLY_TIERS.includes(tier.modelRole);
  assert.equal(isFalOnlyPhotoRole(tier.modelRole), falOnly, tier.modelRole);
  assert.deepEqual(providers, falOnly ? ["fal"] : FAL_TIERS.includes(tier.modelRole) ? ["replicate", "fal"] : ["replicate"], tier.modelRole);
  const def = getModelDefault("photo", tier.modelRole);
  const resetProvider = falOnly ? "fal" : "replicate";
  assert.ok(def?.provider === resetProvider && def.model === tier.providerModel && Object.keys(def.parameters).length === 0, `reset default is ${resetProvider} + catalog model + empty params`);
  for (const o of photoProviderOptions(tier.modelRole)) {
    assert.ok(isSupportedProviderModel(o.provider, o.model, { toolKey: "photo", configKey: tier.modelRole }), "offered pair must pass the catalog");
  }
}
assert.equal(photoSwitchTarget("image_seedream4", "fal"), null, "retired tier (#476): no options, no switch");
assert.equal(photoSwitchTarget("image_basic", "fal")?.model, "fal-ai/nano-banana");
assert.equal(photoSwitchTarget("image_basic", "replicate")?.model, "google/nano-banana");
assert.deepEqual(photoSwitchTarget("image_basic", "replicate")?.parameters, {});
assert.equal(photoPatchUnit("image_basic", { provider: "replicate", model: "google/nano-banana" }, { provider: "fal" }).ok, false, "provider change keeping the old model is rejected");
assert.equal(photoPatchUnit("image_basic", { provider: "replicate", model: "google/nano-banana" }, { provider: "fal", model: "fal-ai/nano-banana" }).ok, true);
assert.deepEqual(photoPatchUnit("image_basic", { provider: "replicate", model: "google/nano-banana" }, { provider: "fal", model: "fal-ai/nano-banana" }), { ok: true, parameters: {} }, "catalog unit forces catalog params");
assert.equal(photoPatchUnit("image_basic", { provider: "fal", model: "fal-ai/nano-banana" }, { provider: "replicate" }).ok, false, "rollback by PATCH needs the catalog model too");
assert.equal(photoPatchUnit("image_basic", { provider: "fal", model: "fal-ai/nano-banana" }, { provider: "replicate", model: "google/nano-banana" }).ok, true, "rollback unit allowed");
assert.equal(photoPatchUnit("image_basic", { provider: "fal", model: "fal-ai/nano-banana" }, { model: "fal-ai/other" }).ok, false, "off-catalog fal model rejected");
assert.deepEqual(photoPatchUnit("image_basic", { provider: "replicate", model: "google/nano-banana" }, { model: "google/nano-banana-x" }), { ok: true }, "replicate model edit stays free");
assert.deepEqual(photoPatchUnit("image_basic", { provider: "fal", model: "fal-ai/nano-banana" }, { parameters: { x: 1 } }), { ok: true, parameters: {} }, "free-form PATCH params on a Fal row reset to catalog");
assert.deepEqual(photoPatchUnit("image_seedream4", { provider: "replicate", model: "a" }, { model: "b" }), { ok: true }, "a row for a retired tier (#476) is not constrained by the switch guard");
assert.equal(activePhotoProvider("image_basic", null), "replicate", "missing row is replicate");
assert.equal(activePhotoProvider("image_basic", { provider: "fal", model: "fal-ai/nano-banana", enabled: true }), "fal");
assert.equal(activePhotoProvider("image_basic", { provider: "fal", model: "bogus", enabled: true }), "replicate", "off-catalog is replicate");
// #467: a Fal-only row can never be moved to Replicate, by the switch or by a PATCH.
const krea = { provider: "fal", model: "fal-ai/krea-2/turbo" };
assert.equal(photoSwitchTarget("image_krea2_turbo", "replicate"), null, "Fal-only tier has no Replicate target");
assert.deepEqual(photoSwitchTarget("image_krea2_turbo", "fal"), { ...krea, parameters: {} });
assert.equal(photoPatchUnit("image_krea2_turbo", krea, { provider: "replicate" }).ok, false, "Fal-only: provider move rejected");
assert.equal(photoPatchUnit("image_krea2_turbo", krea, { provider: "replicate", model: "fal-ai/krea-2/turbo" }).ok, false, "Fal-only: Fal id never sent to Replicate");
assert.equal(photoPatchUnit("image_krea2_turbo", krea, { model: "fal-ai/other" }).ok, false, "Fal-only: off-catalog model rejected");
assert.deepEqual(photoPatchUnit("image_krea2_turbo", krea, { parameters: { x: 1 } }), { ok: true, parameters: {} }, "Fal-only: params reset to catalog");
assert.equal(activePhotoProvider("image_krea2_turbo", null), "fal", "Fal-only missing row is still fal");
assert.equal(activePhotoProvider("image_krea2_turbo", { ...krea, enabled: false }), "fal", "Fal-only disabled row is still fal");
assert.equal(marginForCost(4, null, DEFAULT_BILLING_SETTINGS), null, "unknown cost has no margin");
const m = marginForCost(4, 0.02, DEFAULT_BILLING_SETTINGS);
assert.ok(m && Math.abs(m.usd - (800 / 18000 - 0.02)) < 1e-9 && m.pct > 50 && m.pct < 56, "margin = price - cost");
// #464: Nano Banana 2 1K is priced off the highest provider cost (fal $0.08 > Replicate $0.067), so no provider loses money.
const nb21k = getPricingDefault("product_photo_nano_banana_2_1k_per_image");
assert.equal(nb21k?.credit_amount, 8, "NB2 1K reset default is 8 credits");
assert.equal(
  calculateCredits({ providerCostUsd: V2_PRICING_DEFAULTS.product_photo_nano_banana_2_1k_per_image.providerCostUsd, unitCount: 1, settings: DEFAULT_BILLING_SETTINGS }),
  8,
  "NB2 1K runtime fallback matches the reset default",
);
for (const cost of [0.067, 0.08]) {
  assert.ok((marginForCost(8, cost, DEFAULT_BILLING_SETTINGS)?.usd ?? -1) > 0, `NB2 1K at 8 credits covers $${cost}`);
}
// #469: same rule for 2K (fal $0.12 > Replicate $0.101 -> 11) and 4K (fal $0.16 > Replicate $0.151 -> 15).
const nb2Balanced = PRODUCT_PHOTO_TIERS.find((t) => t.id === "balanced")!;
for (const [key, credits, costs] of [
  ["product_photo_nano_banana_2_1k_per_image", 8, [0.067, 0.08]],
  ["product_photo_nano_banana_2_2k_per_image", 11, [0.101, 0.12]],
  ["product_photo_nano_banana_2_4k_per_image", 15, [0.151, 0.16]],
] as const) {
  assert.equal(getPricingDefault(key)?.credit_amount, credits, `${key} reset default is ${credits} credits`);
  assert.equal(
    calculateCredits({ providerCostUsd: V2_PRICING_DEFAULTS[key].providerCostUsd, unitCount: 1, settings: DEFAULT_BILLING_SETTINGS }),
    credits,
    `${key} runtime fallback matches the reset default`,
  );
  assert.equal(nb2Balanced.resolutions.find((r) => r.pricingKey === key)?.fallbackCredits, credits, `${key} UI fallback matches`);
  for (const cost of costs) {
    assert.ok((marginForCost(credits, cost, DEFAULT_BILLING_SETTINGS)?.usd ?? -1) > 0, `${key} at ${credits} credits covers $${cost}`);
  }
}
// #466: margin per provider (display only). Costs from provider_model_costs; Replicate falls back to the reference cost.
const nb2Options = photoProviderOptions("image_balanced");
const nb2Margins = providerMargins({
  credits: 8,
  pricingKey: "product_photo_nano_banana_2_1k_per_image",
  referenceUsd: 0.08,
  options: nb2Options,
  activeProvider: "fal",
  costs: {
    [providerCostKey("replicate", "google/nano-banana-2", "product_photo_nano_banana_2_1k_per_image")]: 0.067,
    [providerCostKey("fal", "fal-ai/nano-banana-2", "product_photo_nano_banana_2_1k_per_image")]: 0.08,
  },
  settings: DEFAULT_BILLING_SETTINGS,
});
assert.deepEqual(nb2Margins.map((x) => [x.provider, x.costUsd, x.recorded, x.active]), [["replicate", 0.067, true, false], ["fal", 0.08, true, true]]);
assert.ok(nb2Margins[0].margin!.pct > 24 && nb2Margins[0].margin!.pct < 25 && nb2Margins[1].margin!.pct > 9 && nb2Margins[1].margin!.pct < 10.1, "Replicate ~25%, fal ~10%");
const noRows = providerMargins({ credits: 8, pricingKey: "k", referenceUsd: 0.08, options: nb2Options, activeProvider: "replicate", costs: {}, settings: DEFAULT_BILLING_SETTINGS });
assert.deepEqual(noRows.map((x) => [x.provider, x.costUsd, x.recorded, x.margin === null]), [["replicate", 0.08, false, false], ["fal", null, false, true]], "Replicate falls back to the reference cost; fal without a row is unknown, never a guess");
// #467: Krea 2 Turbo is priced from the verified fal price ($0.008/MP); sizes are pinned to <= 1 MP so one image costs <= $0.008.
assert.equal(calculateCredits({ providerCostUsd: V2_PRICING_DEFAULTS.product_photo_krea_2_turbo_per_image.providerCostUsd, unitCount: 1, settings: DEFAULT_BILLING_SETTINGS }), 1);
assert.equal(getPricingDefault("product_photo_krea_2_turbo_per_image")?.credit_amount, 1, "Krea 2 Turbo reset default is 1 credit");
assert.equal(PRODUCT_PHOTO_TIERS.find((t) => t.id === "krea2_turbo")?.basicFallbackCredits, 1, "Krea 2 Turbo UI fallback matches");
assert.ok((marginForCost(1, 0.008, DEFAULT_BILLING_SETTINGS)?.pct ?? -1) > 25, "Krea 2 Turbo at 1 credit keeps >25% margin on $0.008");
// #474: Krea 2 Large / Medium run on Replicate or fal at the same flat per-image price; priced from the highest.
for (const [key, tierId, credits, costs] of [
  ["product_photo_krea_2_large_per_image", "krea2_large", 6, [0.06, 0.06]],
  ["product_photo_krea_2_medium_per_image", "krea2_medium", 3, [0.03, 0.03]],
] as const) {
  assert.equal(getPricingDefault(key)?.credit_amount, credits, `${key} reset default is ${credits} credits`);
  assert.equal(calculateCredits({ providerCostUsd: V2_PRICING_DEFAULTS[key].providerCostUsd, unitCount: 1, settings: DEFAULT_BILLING_SETTINGS }), credits, `${key} runtime fallback`);
  assert.equal(PRODUCT_PHOTO_TIERS.find((t) => t.id === tierId)?.basicFallbackCredits, credits, `${key} UI fallback matches`);
  for (const cost of costs) assert.ok((marginForCost(credits, cost, DEFAULT_BILLING_SETTINGS)?.usd ?? -1) > 0, `${key} at ${credits} credits covers $${cost}`);
}
assert.equal(photoSwitchTarget("image_krea2_large", "fal")?.model, "krea/v2/large/text-to-image");
assert.equal(photoSwitchTarget("image_krea2_medium", "replicate")?.model, "krea/krea-2-medium");
assert.equal(activePhotoProvider("image_krea2_large", null), "replicate", "Krea 2 Large starts on Replicate");
console.log("admin-provider-switch self-check ok");
