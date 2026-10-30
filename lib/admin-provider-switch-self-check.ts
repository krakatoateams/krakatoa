import assert from "node:assert/strict";
import { DEFAULT_BILLING_SETTINGS } from "./pricing-math";
import { isSupportedProviderModel } from "./ai-provider-catalog";
import { getModelDefault } from "./admin-config-resolved-defaults";
import { PRODUCT_PHOTO_TIERS } from "./product-photo";
import { activePhotoProvider, marginForCost, photoPatchUnit, photoProviderOptions, photoSwitchTarget } from "./admin-provider-switch";

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
assert.deepEqual(photoPatchUnit("image_seedream4", { provider: "replicate", model: "a" }, { model: "b" }), { ok: true }, "non-switchable tier unconstrained");
assert.equal(activePhotoProvider("image_basic", null), "replicate", "missing row is replicate");
assert.equal(activePhotoProvider("image_basic", { provider: "fal", model: "fal-ai/nano-banana", enabled: true }), "fal");
assert.equal(activePhotoProvider("image_basic", { provider: "fal", model: "bogus", enabled: true }), "replicate", "off-catalog is replicate");
assert.equal(marginForCost(4, null, DEFAULT_BILLING_SETTINGS), null, "unknown cost has no margin");
const m = marginForCost(4, 0.02, DEFAULT_BILLING_SETTINGS);
assert.ok(m && Math.abs(m.usd - (800 / 18000 - 0.02)) < 1e-9 && m.pct > 50 && m.pct < 56, "margin = price - cost");
console.log("admin-provider-switch self-check ok");
