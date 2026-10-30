/**
 * Code-defined catalog of (provider, model) pairs the app can actually run.
 * Admin saves and the model resolver both check it, so a mistyped provider can
 * never break a model. `model: "*"` means any model id the provider's generic
 * runner accepts (Replicate runs arbitrary models; Rendi has a single config).
 * Add exact pairs here when a new provider adapter ships (Fal: phases 4/5).
 */
export const PROVIDER_CATALOG: readonly { provider: string; model: string }[] = [
  { provider: "replicate", model: "*" },
  { provider: "rendi", model: "*" },
];

export const SUPPORTED_PROVIDERS: readonly string[] = [...new Set(PROVIDER_CATALOG.map((p) => p.provider))];

export function isSupportedProviderModel(provider: string, model: string): boolean {
  return PROVIDER_CATALOG.some((p) => p.provider === provider && (p.model === "*" || p.model === model));
}
