import { FAL_PHOTO_MODELS } from "@/lib/ai-providers/fal-photo-catalog";
import { PRODUCT_PHOTO_TIERS } from "@/lib/product-photo";
import { calculateCredits, type BillingSettings } from "@/lib/pricing-math";

/**
 * Admin provider switch for the Photo tiers. Pure: the (provider, model, parameters)
 * unit always comes from the code catalog, never from admin-typed values.
 */
export type PhotoProviderId = "replicate" | "fal";

export type PhotoProviderOption = { provider: PhotoProviderId; model: string };

export const PROVIDER_LABEL: Record<PhotoProviderId, string> = { replicate: "Replicate", fal: "fal.ai" };

/** Replicate is always offered; Fal only when the catalog has an entry for the tier. */
export function photoProviderOptions(configKey: string): PhotoProviderOption[] {
  const tier = PRODUCT_PHOTO_TIERS.find((t) => t.modelRole === configKey);
  if (!tier) return [];
  const options: PhotoProviderOption[] = [{ provider: "replicate", model: tier.providerModel }];
  for (const [model, spec] of Object.entries(FAL_PHOTO_MODELS)) {
    if (spec.configKey === configKey) options.push({ provider: "fal", model });
  }
  return options;
}

/** The whole unit to store for a switch, or null when the catalog has no such pair. */
export function photoSwitchTarget(
  configKey: string,
  provider: string
): { provider: PhotoProviderId; model: string; parameters: Record<string, unknown> } | null {
  const option = photoProviderOptions(configKey).find((o) => o.provider === provider);
  return option ? { ...option, parameters: {} } : null;
}

/** Provider of a stored row, falling back to Replicate when the row is missing or off-catalog. */
export function activePhotoProvider(
  configKey: string,
  row: { provider: string; model: string; enabled: boolean } | null | undefined
): PhotoProviderId {
  const match = row?.enabled
    ? photoProviderOptions(configKey).find((o) => o.provider === row.provider && o.model === row.model)
    : undefined;
  return match?.provider ?? "replicate";
}

/** Margin of the fixed user price over the active provider's cost; null when the cost is unknown. */
export function marginForCost(
  credits: number,
  costUsd: number | null,
  settings: BillingSettings
): { usd: number; pct: number } | null {
  if (costUsd === null || credits <= 0) return null;
  const revenueUsd = (credits * settings.creditValueIdr) / settings.usdToIdr;
  const usd = revenueUsd - costUsd;
  return { usd, pct: (usd / revenueUsd) * 100 };
}

/** Credits implied by a cost at current billing settings (for display next to the fixed price). */
export function creditsForCost(costUsd: number, settings: BillingSettings): number {
  return calculateCredits({ providerCostUsd: costUsd, unitCount: 1, settings });
}
