import { getPricingDefault } from "@/lib/admin-config-resolved-defaults";
import type { PricingConfigPatch } from "@/lib/pricing-configs-db";

export type MissingPricingConfigInsert = {
  pricing_key: string;
  display_name: string;
  pricing_type: NonNullable<PricingConfigPatch["pricing_type"]>;
  credit_amount: number;
  enabled: boolean;
  is_deprecated: boolean;
  metadata: Record<string, unknown>;
  provider_cost_usd: number | null;
  cost_unit: PricingConfigPatch["cost_unit"];
  pricing_group: string | null;
  variant_key: string | null;
  currency: string;
  updated_by_profile_id: string | null;
};

function displayNameFromPricingKey(pricingKey: string): string {
  return pricingKey
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function buildMissingPricingConfigInsert(
  pricingKey: string,
  patch: PricingConfigPatch,
  updatedByProfileId: string | null
): MissingPricingConfigInsert | null {
  const defaults = getPricingDefault(pricingKey);
  if (!defaults) return null;

  return {
    pricing_key: pricingKey,
    display_name: patch.display_name ?? displayNameFromPricingKey(pricingKey),
    pricing_type: patch.pricing_type ?? defaults.pricing_type,
    credit_amount: patch.credit_amount ?? defaults.credit_amount,
    enabled: patch.enabled ?? defaults.enabled,
    is_deprecated: defaults.is_deprecated ?? false,
    metadata: patch.metadata ?? {},
    provider_cost_usd:
      patch.provider_cost_usd !== undefined
        ? patch.provider_cost_usd
        : defaults.provider_cost_usd ?? null,
    cost_unit:
      patch.cost_unit !== undefined ? patch.cost_unit : defaults.cost_unit ?? null,
    pricing_group:
      patch.pricing_group !== undefined
        ? patch.pricing_group
        : defaults.pricing_group ?? null,
    variant_key:
      patch.variant_key !== undefined ? patch.variant_key : defaults.variant_key ?? null,
    currency: patch.currency ?? defaults.currency ?? "USD",
    updated_by_profile_id: updatedByProfileId,
  };
}
