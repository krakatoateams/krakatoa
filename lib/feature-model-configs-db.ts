import { supabaseServer } from "@/lib/supabase-server";
import {
  defaultFeatureModelRows,
  defaultTierForFeature,
  eligibleTiersForFeature,
  isPhotoFeatureKey,
  type PhotoFeatureKey,
} from "@/lib/creation-features";

/**
 * Per-feature model enablement data access (service-role) — Admin Config v3.
 *
 * Stores which Photo model tiers are offered for each creation feature (Image
 * generation / Product try-on / Character generation) and the per-feature default.
 * The catalog of features × eligible tiers lives in code (lib/creation-features.ts);
 * this table only persists admin overrides. A MISSING row means the shipped
 * default (enabled), so the feature works before rows are materialized.
 *
 * Keep aligned (same contract as admin-config-defaults.ts):
 *   SQL table  — supabase/migrations/012_feature_model_enablement.sql
 *   Defaults   — lib/creation-features.ts (defaultFeatureModelRows / defaultTierForFeature)
 */

export type FeatureModelConfig = {
  id: string;
  tool_key: string;
  feature_key: string;
  model_tier: string;
  enabled: boolean;
  is_default: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
  updated_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

const TABLE = "feature_model_configs";

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (
    error.message.includes(TABLE) &&
    (error.message.includes("schema cache") || error.message.includes("does not exist"))
  ) {
    throw new Error(
      `Database table ${TABLE} is missing. Apply supabase/migrations/012_feature_model_enablement.sql ` +
        "(GET /api/dev/setup-db?file=012_feature_model_enablement.sql, or run it in the Supabase SQL editor)."
    );
  }
  throw new Error(error.message || fallback);
}

/** List all feature-model rows ordered for stable display. */
export async function listFeatureModelConfigs(): Promise<FeatureModelConfig[]> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("*")
    .order("tool_key", { ascending: true })
    .order("feature_key", { ascending: true })
    .order("sort_order", { ascending: true });

  handleError(error, "Failed to list feature model configs.");
  return (data as FeatureModelConfig[] | null) ?? [];
}

export async function getFeatureModelConfigById(
  id: string
): Promise<FeatureModelConfig | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  handleError(error, "Failed to fetch feature model config.");
  return (data as FeatureModelConfig | null) ?? null;
}

/**
 * Materialize any missing (feature × eligible tier) rows from the code catalog.
 * Idempotent: never clobbers an existing admin-edited row (insert-missing only).
 * Returns the full, ordered list afterwards. Called by the admin GET so the panel
 * always shows the complete matrix, including newly added code tiers.
 */
export async function ensureFeatureModelRows(): Promise<FeatureModelConfig[]> {
  const existing = await listFeatureModelConfigs();
  const seen = new Set(
    existing.map((r) => `${r.tool_key}:${r.feature_key}:${r.model_tier}`)
  );

  const missing = defaultFeatureModelRows()
    .filter((d) => !seen.has(`${d.toolKey}:${d.featureKey}:${d.modelTier}`))
    .map((d) => ({
      tool_key: d.toolKey,
      feature_key: d.featureKey,
      model_tier: d.modelTier,
      enabled: d.enabled,
      is_default: d.isDefault,
      sort_order: d.sortOrder,
    }));

  if (missing.length === 0) return existing;

  const { error } = await supabaseServer.from(TABLE).insert(missing);
  // on conflict shouldn't happen (we filtered), but ignore duplicate races.
  if (error && !error.message.includes("duplicate")) {
    handleError(error, "Failed to materialize feature model configs.");
  }
  return listFeatureModelConfigs();
}

export type FeatureModelConfigPatch = {
  enabled?: boolean;
  is_default?: boolean;
};

/**
 * Update a feature-model row by id. Enforces at most one default per
 * (tool_key, feature_key): setting is_default=true clears the other rows first.
 */
export async function updateFeatureModelConfig(
  id: string,
  patch: FeatureModelConfigPatch,
  updatedByProfileId: string | null
): Promise<FeatureModelConfig | null> {
  const row = await getFeatureModelConfigById(id);
  if (!row) return null;

  if (patch.is_default === true) {
    const { error: clearErr } = await supabaseServer
      .from(TABLE)
      .update({ is_default: false, updated_by_profile_id: updatedByProfileId })
      .eq("tool_key", row.tool_key)
      .eq("feature_key", row.feature_key)
      .neq("id", id);
    handleError(clearErr, "Failed to clear previous default.");
  }

  const update: Record<string, unknown> = { updated_by_profile_id: updatedByProfileId };
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.is_default !== undefined) update.is_default = patch.is_default;

  const { data, error } = await supabaseServer
    .from(TABLE)
    .update(update)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to update feature model config.");
  return (data as FeatureModelConfig | null) ?? null;
}

/** Reset a row to its shipped code default (enabled=true; default per code catalog). */
export async function resetFeatureModelConfig(
  id: string,
  updatedByProfileId: string | null
): Promise<FeatureModelConfig | null> {
  const row = await getFeatureModelConfigById(id);
  if (!row) return null;

  const isDefault =
    isPhotoFeatureKey(row.feature_key) &&
    defaultTierForFeature(row.feature_key) === row.model_tier;

  // Clearing/setting default mirrors the single-default-per-feature invariant.
  if (isDefault) {
    const { error: clearErr } = await supabaseServer
      .from(TABLE)
      .update({ is_default: false, updated_by_profile_id: updatedByProfileId })
      .eq("tool_key", row.tool_key)
      .eq("feature_key", row.feature_key)
      .neq("id", id);
    handleError(clearErr, "Failed to clear previous default.");
  }

  const { data, error } = await supabaseServer
    .from(TABLE)
    .update({ enabled: true, is_default: isDefault, updated_by_profile_id: updatedByProfileId })
    .eq("id", id)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to reset feature model config.");
  return (data as FeatureModelConfig | null) ?? null;
}

// ---------------------------------------------------------------------------
// Runtime enablement resolver (never throws; falls back to code defaults).
// ---------------------------------------------------------------------------

export type FeatureEnablement = {
  enabledTiers: string[];
  defaultTier: string;
};

const CACHE_TTL_MS = 60_000;
type EnablementCache = {
  map: Record<PhotoFeatureKey, FeatureEnablement> | null;
  expiresAt: number;
};
let cache: EnablementCache = { map: null, expiresAt: 0 };

/** Pure code-default enablement (every eligible tier enabled; code default tier). */
function codeDefaults(): Record<PhotoFeatureKey, FeatureEnablement> {
  const out = {} as Record<PhotoFeatureKey, FeatureEnablement>;
  for (const featureKey of ["image", "product", "character"] as PhotoFeatureKey[]) {
    out[featureKey] = {
      enabledTiers: eligibleTiersForFeature(featureKey),
      defaultTier: defaultTierForFeature(featureKey),
    };
  }
  return out;
}

/**
 * Resolve enabled tiers + default per Photo feature, merging admin DB overrides
 * over the code catalog. Eligibility (reference capability) is always enforced in
 * code. A missing row = enabled. Cached ~60s; on any DB error returns code
 * defaults so the omni-form and generation routes never break.
 */
export async function getPhotoFeatureEnablement(): Promise<
  Record<PhotoFeatureKey, FeatureEnablement>
> {
  const now = Date.now();
  if (cache.map && now < cache.expiresAt) return cache.map;

  try {
    const rows = await listFeatureModelConfigs();
    const byKey = new Map<string, FeatureModelConfig>();
    for (const r of rows) byKey.set(`${r.feature_key}:${r.model_tier}`, r);

    const out = {} as Record<PhotoFeatureKey, FeatureEnablement>;
    for (const featureKey of ["image", "product", "character"] as PhotoFeatureKey[]) {
      const eligible = eligibleTiersForFeature(featureKey);
      const enabledTiers = eligible.filter((tier) => {
        const row = byKey.get(`${featureKey}:${tier}`);
        return row ? row.enabled : true; // missing row => shipped default (enabled)
      });

      // Default: an enabled, eligible row flagged is_default wins; otherwise the
      // code default when still enabled; otherwise the first enabled tier.
      const dbDefault = eligible.find((tier) => {
        const row = byKey.get(`${featureKey}:${tier}`);
        return row?.is_default && enabledTiers.includes(tier);
      });
      const codeDefault = defaultTierForFeature(featureKey);
      const defaultTier =
        dbDefault ??
        (enabledTiers.includes(codeDefault) ? codeDefault : enabledTiers[0] ?? codeDefault);

      out[featureKey] = { enabledTiers, defaultTier };
    }

    cache = { map: out, expiresAt: now + CACHE_TTL_MS };
    return out;
  } catch (e) {
    console.warn("[feature-model-configs] DB read failed, using code defaults:", e);
    return codeDefaults();
  }
}
