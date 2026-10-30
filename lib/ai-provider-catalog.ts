import { FAL_PHOTO_MODELS } from "@/lib/ai-providers/fal-photo-catalog";

/**
 * Code-defined catalog of (provider, model) pairs the app can actually run.
 * Admin saves and the model resolver both check it, so a mistyped provider can
 * never break a model. `model: "*"` means any model id the provider's generic
 * runner accepts (Replicate runs arbitrary models; Rendi has a single config).
 * An entry with `toolKey` / `configKey` only applies to that model_configs row, so a
 * provider can never be set on a feature it has no adapter for. Fal pairs are exact:
 * the three Nano Banana photo tiers (GPT Image 2.5 Flare on Fal is phase 5).
 */
export type ProviderCatalogEntry = { provider: string; model: string; toolKey?: string; configKey?: string };

export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  { provider: "replicate", model: "*" },
  { provider: "rendi", model: "*", toolKey: "render" },
  ...Object.entries(FAL_PHOTO_MODELS).map(([model, spec]) => ({
    provider: "fal",
    model,
    toolKey: "photo",
    configKey: spec.configKey,
  })),
];

export const SUPPORTED_PROVIDERS: readonly string[] = [...new Set(PROVIDER_CATALOG.map((p) => p.provider))];

/** Fail closed: a scoped entry needs a matching `scope`; with no scope only unscoped entries match. */
export function isSupportedProviderModel(
  provider: string,
  model: string,
  scope?: { toolKey: string; configKey: string }
): boolean {
  return PROVIDER_CATALOG.some(
    (p) =>
      p.provider === provider &&
      (p.model === "*" || p.model === model) &&
      (p.toolKey === undefined || p.toolKey === scope?.toolKey) &&
      (p.configKey === undefined || p.configKey === scope?.configKey)
  );
}

/** Fal can only be selected when its key exists (server env); other providers keep their current behavior. */
export function isProviderConfigured(provider: string): boolean {
  return provider !== "fal" || Boolean(process.env.FAL_KEY);
}
