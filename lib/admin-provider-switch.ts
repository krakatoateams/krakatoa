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

/** Whether a Photo role is a Fal-only tier (#467): no Replicate option, never a Replicate fallback. */
export function isFalOnlyPhotoRole(configKey: string): boolean {
  return PRODUCT_PHOTO_TIERS.some((t) => t.modelRole === configKey && t.falOnly);
}

/** Replicate is offered except on a Fal-only tier; Fal only when the catalog has an entry for the tier. */
export function photoProviderOptions(configKey: string): PhotoProviderOption[] {
  const tier = PRODUCT_PHOTO_TIERS.find((t) => t.modelRole === configKey);
  if (!tier) return [];
  const options: PhotoProviderOption[] = tier.falOnly ? [] : [{ provider: "replicate", model: tier.providerModel }];
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
  // A Fal-only row stays constrained even with one option: it must never be moved to Replicate.
  if (options.length < 2 && !isFalOnlyPhotoRole(configKey)) return { ok: true };
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

/**
 * Provider of a stored row, falling back to Replicate when the row is missing or off-catalog.
 * A Fal-only tier is always Fal (it never runs anywhere else), so "configured" means FAL_KEY.
 */
export function activePhotoProvider(
  configKey: string,
  row: { provider: string; model: string; enabled: boolean } | null | undefined
): PhotoProviderId {
  if (isFalOnlyPhotoRole(configKey)) return "fal";
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

/** Lookup key into provider_model_costs rows: `${provider}|${model}|${pricing_key}`. */
export function providerCostKey(provider: string, model: string, pricingKey: string): string {
  return `${provider}|${model}|${pricingKey}`;
}

export type ProviderMargin = {
  provider: PhotoProviderId;
  /** null = no recorded cost (shown as "cost not set", never a guess). */
  costUsd: number | null;
  /** True when the cost comes from provider_model_costs; false for the Replicate fallback. */
  recorded: boolean;
  active: boolean;
  margin: { usd: number; pct: number } | null;
};

/**
 * Margin of one variant's price on every provider the tier can run on (display only, #466).
 * Costs come from provider_model_costs. Replicate without a recorded row falls back to the
 * variant's reference cost, which was the old margin source; Fal without a row stays unknown.
 */
export function providerMargins(params: {
  credits: number;
  pricingKey: string;
  referenceUsd: number;
  options: readonly PhotoProviderOption[];
  activeProvider: PhotoProviderId;
  costs: Record<string, number>;
  settings: BillingSettings;
}): ProviderMargin[] {
  return params.options.map((o) => {
    const recordedCost = params.costs[providerCostKey(o.provider, o.model, params.pricingKey)];
    const recorded = recordedCost !== undefined;
    const costUsd = recorded ? recordedCost : o.provider === "replicate" ? params.referenceUsd : null;
    return {
      provider: o.provider,
      costUsd,
      recorded,
      active: o.provider === params.activeProvider,
      margin: marginForCost(params.credits, costUsd, params.settings),
    };
  });
}
