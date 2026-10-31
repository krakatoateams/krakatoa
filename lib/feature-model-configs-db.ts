import { supabaseServer } from "@/lib/supabase-server";
import { generationErrorLogSafe } from "@/lib/error-log-safe";
import {
  defaultFeatureModelRows,
  defaultTierForFeature,
  eligibleTiersForFeature,
  isPhotoFeatureKey,
  PHOTO_FEATURE_KEYS,
  type PhotoFeatureKey,
} from "@/lib/creation-features";
import {
  defaultModelForComposer,
  defaultVideoComposerRows,
  eligibleModelsForComposer,
  isVideoComposerKey,
  VIDEO_COMPOSER_KEYS,
  type VideoComposerKey,
} from "@/lib/video-composer-features";
import {
  isTableMissing,
  ModelStateUnavailableError,
  ModelTableMissingError,
  withModelStateTimeout,
} from "@/lib/model-state-unavailable";
import { getEnabledCatalogModelIds } from "@/lib/model-catalog-configs-db";
import { setFeatureDefaultSafely } from "@/lib/feature-default-switch";
import { resolveFeatureEnablement, type FeatureEnablement } from "@/lib/feature-enablement";

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
  if (isTableMissing(error, TABLE)) {
    throw new ModelTableMissingError(
      `Database table ${TABLE} is missing. Apply supabase/migrations/012_feature_model_enablement.sql ` +
        "through the configured Supabase MCP or SQL Editor, or run npm run db:setup with DATABASE_URL."
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

  const missing = [...defaultFeatureModelRows(), ...defaultVideoComposerRows()]
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

/**
 * Compare-and-set variant of updateFeatureModelConfig: the target row changes only while its
 * updated_at still equals what the admin saw (null = no row matched, nothing written). Other
 * defaults of the feature are cleared only after the target row won.
 */
export async function casFeatureModelConfig(
  id: string,
  patch: FeatureModelConfigPatch,
  expectedUpdatedAt: string,
  updatedByProfileId: string | null
): Promise<FeatureModelConfig | null> {
  const update: Record<string, unknown> = { updated_by_profile_id: updatedByProfileId };
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.is_default !== undefined) update.is_default = patch.is_default;
  const before = await getFeatureModelConfigById(id);

  try {
    return await setFeatureDefaultSafely<FeatureModelConfig>({
      makesDefault: patch.is_default === true,
      writeTarget: async () => {
        const { data, error } = await supabaseServer
          .from(TABLE)
          .update(update)
          .eq("id", id)
          .eq("updated_at", expectedUpdatedAt)
          .select("*")
          .maybeSingle();
        handleError(error, "Failed to update feature model config.");
        return (data as FeatureModelConfig | null) ?? null;
      },
      clearOthers: async () => {
        if (!before) return;
        const { error } = await supabaseServer
          .from(TABLE)
          .update({ is_default: false, updated_by_profile_id: updatedByProfileId })
          .eq("tool_key", before.tool_key)
          .eq("feature_key", before.feature_key)
          .neq("id", id);
        handleError(error, "Failed to clear previous default.");
      },
      revertTarget: async () => {
        if (!before) return;
        const { error } = await supabaseServer
          .from(TABLE)
          .update({ enabled: before.enabled, is_default: before.is_default, updated_by_profile_id: before.updated_by_profile_id })
          .eq("id", id);
        handleError(error, "Failed to restore the feature model config.");
      },
      onCompensationFailed: (e) =>
        console.error("[feature-model-configs] could not undo a partial default switch:", generationErrorLogSafe(e)),
    });
  } finally {
  }
}

/** Reset a row to its shipped code default (enabled=true; default per code catalog). */
export async function resetFeatureModelConfig(
  id: string,
  updatedByProfileId: string | null
): Promise<FeatureModelConfig | null> {
  const row = await getFeatureModelConfigById(id);
  if (!row) return null;

  const isDefault =
    row.tool_key === "photo" &&
    isPhotoFeatureKey(row.feature_key) &&
    defaultTierForFeature(row.feature_key) === row.model_tier
      ? true
      : row.tool_key === "reels" &&
          isVideoComposerKey(row.feature_key) &&
          defaultModelForComposer(row.feature_key) === row.model_tier;

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
// Runtime enablement resolver. FAILS CLOSED (ModelStateUnavailableError) when admin state cannot
// be read; only a table that does not exist at all resolves from the shipped code defaults.
// ---------------------------------------------------------------------------

export type { FeatureEnablement };

/** Read seams (injectable so self-checks can simulate read failures). */
export type EnablementReaders = {
  listRows: () => Promise<FeatureModelConfig[]>;
  catalogIds: (toolKey: "photo" | "reels") => Promise<Set<string>>;
};

const defaultReaders: EnablementReaders = {
  listRows: listFeatureModelConfigs,
  catalogIds: getEnabledCatalogModelIds,
};

/** Rows + catalog ids, or ModelStateUnavailableError. A missing feature table = no admin rows. */
async function readState(toolKey: "photo" | "reels", readers: EnablementReaders) {
  try {
    const [rows, catalogEnabled] = await withModelStateTimeout(
      Promise.all([
        readers.listRows().catch((e) => {
          if (e instanceof ModelTableMissingError) return [] as FeatureModelConfig[];
          throw e;
        }),
        readers.catalogIds(toolKey),
      ])
    );
    return { rows, catalogEnabled };
  } catch (e) {
    if (e instanceof ModelStateUnavailableError) throw e;
    console.warn("[feature-model-configs] DB read failed, failing closed:", generationErrorLogSafe(e));
    throw new ModelStateUnavailableError(e);
  }
}

/**
 * Resolve enabled tiers + default per Photo feature, merging admin DB overrides
 * over the code catalog. Eligibility (reference capability) is always enforced in
 * code. A missing row = enabled. Throws ModelStateUnavailableError when state is unreadable.
 */
export async function getPhotoFeatureEnablement(
  readers: EnablementReaders = defaultReaders
): Promise<Record<PhotoFeatureKey, FeatureEnablement>> {
  const { rows, catalogEnabled } = await readState("photo", readers);
  const byKey = new Map<string, FeatureModelConfig>();
  for (const r of rows) byKey.set(`${r.feature_key}:${r.model_tier}`, r);

  const out = {} as Record<PhotoFeatureKey, FeatureEnablement>;
  for (const featureKey of PHOTO_FEATURE_KEYS) {
    out[featureKey] = resolveFeatureEnablement({
      eligible: eligibleTiersForFeature(featureKey),
      catalogEnabled,
      rowFor: (tier) => byKey.get(`${featureKey}:${tier}`),
      codeDefault: defaultTierForFeature(featureKey),
    });
  }
  return out;
}

/**
 * Resolve enabled models + default per Video composer, merging admin DB overrides
 * over the code catalog. Eligibility is always enforced in code. Throws
 * ModelStateUnavailableError when state is unreadable.
 */
export async function getVideoComposerEnablement(
  readers: EnablementReaders = defaultReaders
): Promise<Record<VideoComposerKey, FeatureEnablement>> {
  const { rows, catalogEnabled } = await readState("reels", readers);
  const byKey = new Map<string, FeatureModelConfig>();
  for (const r of rows.filter((r) => r.tool_key === "reels")) byKey.set(`${r.feature_key}:${r.model_tier}`, r);

  const out = {} as Record<VideoComposerKey, FeatureEnablement>;
  for (const composerKey of VIDEO_COMPOSER_KEYS) {
    out[composerKey] = resolveFeatureEnablement({
      eligible: eligibleModelsForComposer(composerKey),
      catalogEnabled,
      rowFor: (tier) => byKey.get(`${composerKey}:${tier}`),
      codeDefault: defaultModelForComposer(composerKey),
    });
  }
  return out;
}
