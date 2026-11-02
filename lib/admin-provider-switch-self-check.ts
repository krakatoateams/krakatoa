import assert from "node:assert/strict";
import { calculateCredits, DEFAULT_BILLING_SETTINGS } from "./pricing-math";
import { V2_PRICING_DEFAULTS } from "./pricing-defaults";
import { isSupportedProviderModel } from "./ai-provider-catalog";
import { getModelDefault, getPricingDefault } from "./admin-config-resolved-defaults";
import { PRODUCT_PHOTO_TIERS } from "./product-photo";
import { lowestPackIdrPerCredit, type CreditPack } from "./credit-packs";
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
// #481: the margin's revenue is the lowest real pack price per credit (base + bonus), not creditValueIdr (200).
const pack = (id: string, credits: number, priceIdr: number, bonusCredits?: number): CreditPack => ({ id, credits, bonusCredits, priceIdr, priceUsdCents: 0, label: id });
const LIVE_PACKS = [pack("p1", 100, 29_000), pack("p3", 250, 69_000), pack("p4", 500, 142_500, 25), pack("p5", 1_000, 299_000, 100)];
const SELL = 142_500 / 525; // p4 with its 25 bonus credits (~Rp271) beats p5 (~Rp272) and the no-bonus packs
assert.equal(lowestPackIdrPerCredit(LIVE_PACKS), SELL, "lowest effective rate counts bonus credits");
assert.equal(lowestPackIdrPerCredit([]), null, "no packs: no rate");
assert.equal(lowestPackIdrPerCredit([{ ...LIVE_PACKS[3], isActive: false }, { ...LIVE_PACKS[0], isActive: true }]), 290, "disabled packs are ignored");
assert.equal(lowestPackIdrPerCredit([{ ...LIVE_PACKS[0], isActive: false }]), null, "only disabled packs: no rate");
assert.equal(lowestPackIdrPerCredit([pack("free", 100, 0), pack("bad", 0, 1_000)]), null, "zero price or zero credits is unusable");
// Nano Banana Pro 4K: 27 credits on a $0.30 cost read 0% on the old cost basis; at the real pack rate it is ~26%.
const pro4k = (sell: number | null, costUsd: number) =>
  providerMargins({ credits: 27, pricingKey: "k", referenceUsd: costUsd, options: [{ provider: "replicate", model: "m" }], activeProvider: "replicate", costs: {}, settings: DEFAULT_BILLING_SETTINGS, sellIdrPerCredit: sell })[0].margin;
assert.ok(Math.abs(marginForCost(27, 0.3, DEFAULT_BILLING_SETTINGS)!.pct) < 1e-9, "old basis showed 0%");
assert.ok(Math.abs(pro4k(SELL, 0.3)!.pct - (1 - 0.3 / ((27 * SELL) / 18000)) * 100) < 1e-9 && pro4k(SELL, 0.3)!.pct > 26 && pro4k(SELL, 0.3)!.pct < 27, "Pro 4K ~26%");
assert.equal(pro4k(null, 0.3), null, "no readable pack: no margin (a dash), never the old number");
assert.equal(pro4k(SELL, 0)!.pct, 100, "zero cost is a 100% margin");
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
  sellIdrPerCredit: SELL,
});
assert.deepEqual(nb2Margins.map((x) => [x.provider, x.costUsd, x.recorded, x.active]), [["replicate", 0.067, true, false], ["fal", 0.08, true, true]]);
// 8 credits at ~Rp271 = ~$0.121: Replicate $0.067 ~44%, fal $0.08 ~34% (on the old cost basis these read ~25% / ~10%).
assert.ok(nb2Margins[0].margin!.pct > 44 && nb2Margins[0].margin!.pct < 45 && nb2Margins[1].margin!.pct > 33 && nb2Margins[1].margin!.pct < 34, "Replicate ~44%, fal ~34%");
const noRows = providerMargins({ credits: 8, pricingKey: "k", referenceUsd: 0.08, options: nb2Options, activeProvider: "replicate", costs: {}, settings: DEFAULT_BILLING_SETTINGS, sellIdrPerCredit: SELL });
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
