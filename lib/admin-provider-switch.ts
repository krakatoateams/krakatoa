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

/**
 * Generic PATCH guard: a provider change, or any model change while on Fal, must land on a catalog
 * unit (and then parameters are reset to the catalog's), so provider + model + params only change
 * together. Replicate-to-Replicate model edits stay free. Non-switchable rows are not constrained here.
 */
export function photoPatchUnit(
  configKey: string,
  row: { provider: string; model: string },
  patch: { provider?: string; model?: string; parameters?: unknown }
): { ok: true; parameters?: Record<string, unknown> } | { ok: false; error: string } {
  const options = photoProviderOptions(configKey);
  if (options.length < 2) return { ok: true };
  const provider = patch.provider ?? row.provider;
  const model = patch.model ?? row.model;
  // The Fal mapper ignores row parameters, so a free-form PATCH on a Fal row is reset to catalog (empty).
  if (provider === "fal" && patch.parameters !== undefined && provider === row.provider && model === row.model) {
    return { ok: true, parameters: {} };
  }
  const providerChanged = provider !== row.provider;
  if (!providerChanged && !(provider === "fal" && model !== row.model)) return { ok: true };
  if (!options.some((o) => o.provider === provider && o.model === model)) {
    return {
      ok: false,
      error: "Provider and model change together as a catalog unit. Use the provider switch for this model.",
    };
  }
  return { ok: true, parameters: {} };
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
