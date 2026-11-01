import assert from "node:assert/strict";
import { calculateCredits, DEFAULT_BILLING_SETTINGS } from "./pricing-math";
import { V2_PRICING_DEFAULTS } from "./pricing-defaults";
import { isSupportedProviderModel } from "./ai-provider-catalog";
import { getModelDefault, getPricingDefault } from "./admin-config-resolved-defaults";
import { PRODUCT_PHOTO_TIERS } from "./product-photo";
import { activePhotoProvider, marginForCost, photoPatchUnit, photoProviderOptions, photoSwitchTarget, providerCostKey, providerMargins } from "./admin-provider-switch";

const FAL_TIERS = ["image_basic", "image_balanced", "image_pro", "image_gpt_image_2"];
for (const tier of PRODUCT_PHOTO_TIERS) {
  const providers = photoProviderOptions(tier.modelRole).map((o) => o.provider);
  assert.deepEqual(providers, FAL_TIERS.includes(tier.modelRole) ? ["replicate", "fal"] : ["replicate"], tier.modelRole);
  const def = getModelDefault("photo", tier.modelRole);
  assert.ok(def?.provider === "replicate" && def.model === tier.providerModel && Object.keys(def.parameters).length === 0, "reset default is Replicate + catalog model + empty params");
  for (const o of photoProviderOptions(tier.modelRole)) {
    assert.ok(isSupportedProviderModel(o.provider, o.model, { toolKey: "photo", configKey: tier.modelRole }), "offered pair must pass the catalog");
  }
}
assert.equal(photoSwitchTarget("image_seedream4", "fal"), null, "no fal entry, no switch");
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
assert.deepEqual(photoPatchUnit("image_seedream4", { provider: "replicate", model: "a" }, { model: "b" }), { ok: true }, "non-switchable tier unconstrained");
assert.equal(activePhotoProvider("image_basic", null), "replicate", "missing row is replicate");
assert.equal(activePhotoProvider("image_basic", { provider: "fal", model: "fal-ai/nano-banana", enabled: true }), "fal");
assert.equal(activePhotoProvider("image_basic", { provider: "fal", model: "bogus", enabled: true }), "replicate", "off-catalog is replicate");
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
console.log("admin-provider-switch self-check ok");
