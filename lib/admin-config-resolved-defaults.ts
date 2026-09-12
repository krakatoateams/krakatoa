import {
  MODEL_DEFAULTS,
  PRICING_DEFAULTS,
  type ModelDefault,
  type PricingDefault,
} from "@/lib/admin-config-defaults";
import { MOTION_CONTROL_MODELS } from "@/lib/motion-control-models";
import { calculateCredits, DEFAULT_BILLING_SETTINGS } from "@/lib/pricing-math";
import { getV2PricingDefault } from "@/lib/pricing-defaults";
import { PRODUCT_PHOTO_TIERS } from "@/lib/product-photo";
import { VIDEO_MODELS } from "@/lib/video-models";
import type { PricingType } from "@/lib/pricing-configs-db";

/**
 * Registry-backed reset defaults. Kept separate from admin-config-defaults so
 * client-side tool availability does not import the full model registries.
 */
export function getPricingDefault(pricingKey: string): PricingDefault | null {
  const explicit = PRICING_DEFAULTS[pricingKey];
  if (explicit) return explicit;

  const builtin = getV2PricingDefault(pricingKey);
  if (!builtin) return null;
  const pricingType: PricingType =
    builtin.costUnit === "per_second"
      ? "per_second"
      : builtin.costUnit === "per_image"
        ? "per_image"
        : "fixed";
  return {
    pricing_type: pricingType,
    credit_amount: calculateCredits({
      providerCostUsd: builtin.providerCostUsd,
      unitCount: 1,
      settings: DEFAULT_BILLING_SETTINGS,
    }),
    enabled: true,
    provider_cost_usd: builtin.providerCostUsd,
    cost_unit: builtin.costUnit,
    pricing_group: builtin.pricingGroup,
    variant_key: builtin.variantKey,
    currency: "USD",
  };
}

export function getModelDefault(
  toolKey: string,
  configKey: string
): ModelDefault | null {
  const explicit = MODEL_DEFAULTS[`${toolKey}.${configKey}`];
  if (explicit) return explicit;

  const registryModel =
    toolKey === "reels"
      ? [...VIDEO_MODELS, ...MOTION_CONTROL_MODELS].find(
          (model) => model.modelRole === configKey
        )
      : toolKey === "photo"
        ? PRODUCT_PHOTO_TIERS.find((tier) => tier.modelRole === configKey)
        : undefined;
  if (!registryModel) return null;
  return {
    provider: "replicate",
    model: registryModel.providerModel,
    parameters: {},
    enabled: true,
    is_default: true,
  };
}
