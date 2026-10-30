/**
 * Pure enabled/default resolution shared by the runtime readers
 * (lib/feature-model-configs-db.ts) and the admin guard (lib/model-catalog-guard.ts),
 * so the rules cannot drift. No I/O.
 */

export type FeatureEnablement = {
  enabledTiers: string[];
  defaultTier: string;
};

export type EnablementRow = { enabled: boolean; is_default: boolean };

/**
 * Enabled tiers + default for one feature/composer. Eligibility is decided by the caller.
 * A model must be enabled in the catalog AND not disabled on its feature row (missing row = enabled).
 * Default: an enabled row flagged is_default wins; else the code default when enabled; else the first enabled tier.
 */
export function resolveFeatureEnablement(params: {
  eligible: readonly string[];
  catalogEnabled: ReadonlySet<string>;
  rowFor: (tier: string) => EnablementRow | undefined;
  codeDefault: string;
}): FeatureEnablement {
  const { eligible, catalogEnabled, rowFor, codeDefault } = params;
  const enabledTiers = eligible.filter((tier) => {
    if (!catalogEnabled.has(tier)) return false;
    const row = rowFor(tier);
    return row ? row.enabled : true;
  });
  const dbDefault = eligible.find((tier) => rowFor(tier)?.is_default && enabledTiers.includes(tier));
  const defaultTier =
    dbDefault ?? (enabledTiers.includes(codeDefault) ? codeDefault : enabledTiers[0] ?? codeDefault);
  return { enabledTiers, defaultTier };
}
