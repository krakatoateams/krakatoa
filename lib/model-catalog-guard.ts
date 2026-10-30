import { defaultModelCatalogRows, type ModelCatalogToolKey } from "@/lib/model-catalog-configs";
import {
  defaultTierForFeature,
  eligibleTiersForFeature,
  getPhotoFeature,
  PHOTO_FEATURE_KEYS,
} from "@/lib/creation-features";
import {
  defaultModelForComposer,
  eligibleModelsForComposer,
  getVideoComposer,
  VIDEO_COMPOSER_KEYS,
} from "@/lib/video-composer-features";
import { REELS_ENGINE_CATALOG_MODEL_ID } from "@/lib/reels-models";
import { resolveFeatureEnablement, type FeatureEnablement } from "@/lib/feature-enablement";
import { modelPricingKeys } from "@/lib/model-pricing-keys";

/**
 * Server-side guardrails for offering / hiding a generation model. Pure: no I/O.
 * Callers pass DB rows in; the rules read the REAL code catalog and the same enablement
 * resolver the runtime uses (lib/feature-enablement.ts). See .scratch/model-registry/spec.md.
 */

export { modelPricingKeys };

export type ModelCatalogChange = "enable" | "disable" | "archive" | "restore";

/** `archived_at` exists only once migration 118 is applied; absent = not archived. */
export type GuardCatalogRow = { tool_key: string; model_id: string; enabled: boolean; archived_at?: string | null };
export type GuardFeatureRow = {
  tool_key: string;
  feature_key: string;
  model_tier: string;
  enabled: boolean;
  is_default: boolean;
};
export type GuardPricingRow = {
  pricing_key: string;
  enabled: boolean;
  is_deprecated: boolean;
  credit_amount: number;
};

export type ModelCatalogGuardInput = {
  toolKey: string;
  modelId: string;
  change: ModelCatalogChange;
  catalogRows: readonly GuardCatalogRow[];
  featureRows: readonly GuardFeatureRow[];
  pricingRows: readonly GuardPricingRow[];
  /** Provider the model runs on today and whether the server can reach it (boolean only). */
  provider: { id: string; configured: boolean };
};

export type ModelCatalogGuardCode =
  | "UNKNOWN_MODEL"
  | "LAST_ENABLED_MODEL"
  | "IS_DEFAULT"
  | "REELS_ENGINE_LAST"
  | "ARCHIVED"
  | "PRICING_NOT_READY"
  | "PROVIDER_NOT_CONFIGURED";

export type ModelCatalogGuardResult =
  | { ok: true; noop: boolean; warnings: string[] }
  | {
      ok: false;
      /** First (highest-priority) violation. */
      code: ModelCatalogGuardCode;
      /** Every violation, same priority order. */
      codes: ModelCatalogGuardCode[];
      reasons: string[];
    };

type Unit = { key: string; label: string; eligible: string[]; codeDefault: string };

/** Composers/features of a tool: the units whose enablement the runtime computes. */
function unitsFor(toolKey: string): Unit[] {
  if (toolKey === "photo") {
    return PHOTO_FEATURE_KEYS.map((key) => ({
      key,
      label: getPhotoFeature(key).label,
      eligible: eligibleTiersForFeature(key),
      codeDefault: defaultTierForFeature(key),
    }));
  }
  return VIDEO_COMPOSER_KEYS.map((key) => ({
    key,
    label: getVideoComposer(key).label,
    eligible: eligibleModelsForComposer(key),
    codeDefault: defaultModelForComposer(key),
  }));
}

/** Catalog-enabled model ids of a tool; a missing row falls back to the shipped default. */
export function catalogEnabledSet(toolKey: string, rows: readonly GuardCatalogRow[]): Set<string> {
  const byId = new Map(rows.filter((r) => r.tool_key === toolKey).map((r) => [r.model_id, r.enabled]));
  const out = new Set<string>();
  for (const def of defaultModelCatalogRows()) {
    if (def.toolKey === toolKey && (byId.get(def.modelId) ?? def.enabled)) out.add(def.modelId);
  }
  return out;
}

/** Enablement of every unit of a tool, exactly as the runtime readers resolve it. */
export function resolveToolEnablement(
  toolKey: string,
  catalogEnabled: ReadonlySet<string>,
  featureRows: readonly GuardFeatureRow[]
): Map<string, FeatureEnablement & { label: string; eligible: string[] }> {
  const byKey = new Map(
    featureRows.filter((r) => r.tool_key === toolKey).map((r) => [`${r.feature_key}:${r.model_tier}`, r])
  );
  const out = new Map<string, FeatureEnablement & { label: string; eligible: string[] }>();
  for (const unit of unitsFor(toolKey)) {
    out.set(unit.key, {
      label: unit.label,
      eligible: unit.eligible,
      ...resolveFeatureEnablement({
        eligible: unit.eligible,
        catalogEnabled,
        rowFor: (tier) => byKey.get(`${unit.key}:${tier}`),
        codeDefault: unit.codeDefault,
      }),
    });
  }
  return out;
}

/** Why a model's pricing is not ready ([] = ready): missing, disabled, deprecated or invalid credit rows. */
export function pricingNotReadyKeys(
  toolKey: string,
  modelId: string,
  pricingRows: readonly GuardPricingRow[]
): string[] {
  const byKey = new Map(pricingRows.map((r) => [r.pricing_key, r]));
  return modelPricingKeys(toolKey, modelId).filter((key) => {
    const row = byKey.get(key);
    return (
      !row || !row.enabled || row.is_deprecated || !Number.isInteger(row.credit_amount) || row.credit_amount < 0
    );
  });
}

const PRIORITY: ModelCatalogGuardCode[] = [
  "UNKNOWN_MODEL",
  "LAST_ENABLED_MODEL",
  "IS_DEFAULT",
  "REELS_ENGINE_LAST",
  "ARCHIVED",
  "PRICING_NOT_READY",
  "PROVIDER_NOT_CONFIGURED",
];

export function checkModelCatalogChange(input: ModelCatalogGuardInput): ModelCatalogGuardResult {
  const { toolKey, modelId, change } = input;
  const fail = (v: { code: ModelCatalogGuardCode; reason: string }[]): ModelCatalogGuardResult => {
    const sorted = [...v].sort((a, b) => PRIORITY.indexOf(a.code) - PRIORITY.indexOf(b.code));
    return {
      ok: false,
      code: sorted[0].code,
      codes: [...new Set(sorted.map((x) => x.code))],
      reasons: sorted.map((x) => x.reason),
    };
  };

  const known = defaultModelCatalogRows().some((r) => r.toolKey === toolKey && r.modelId === modelId);
  if (!known) return fail([{ code: "UNKNOWN_MODEL", reason: "This model is not in the code catalog." }]);

  const archived = input.catalogRows.some((r) => r.tool_key === toolKey && r.model_id === modelId && !!r.archived_at);
  // Restore only clears the archive flag; the model stays not offered (adding it again re-checks pricing/provider).
  if (change === "restore") return { ok: true, noop: !archived, warnings: [] };
  if (change === "enable" && archived) {
    return fail([{ code: "ARCHIVED", reason: "This model is removed. Restore it first, then add it again." }]);
  }
  if (change === "archive" && archived) return { ok: true, noop: true, warnings: [] };

  const before = catalogEnabledSet(toolKey, input.catalogRows);
  const wantEnabled = change === "enable";
  // Archiving a model that is not offered hides nothing, so no hide rule applies; it only sets the flag.
  if (change === "archive" && !before.has(modelId)) return { ok: true, noop: false, warnings: [] };
  if (change !== "archive" && before.has(modelId) === wantEnabled) return { ok: true, noop: true, warnings: [] };

  const violations: { code: ModelCatalogGuardCode; reason: string }[] = [];

  if (!wantEnabled) {
    const after = new Set(before);
    after.delete(modelId);
    const was = resolveToolEnablement(toolKey, before, input.featureRows);
    const now = resolveToolEnablement(toolKey, after, input.featureRows);

    if (after.size === 0) {
      violations.push({ code: "LAST_ENABLED_MODEL", reason: `It is the last offered ${toolKey} model.` });
    }
    const defaultOf: string[] = [];
    for (const [key, w] of was) {
      if (!w.enabledTiers.includes(modelId)) continue;
      if (now.get(key)!.enabledTiers.length === 0) {
        violations.push({
          code: "LAST_ENABLED_MODEL",
          reason: `It is the last enabled model for ${w.label}.`,
        });
      }
      if (w.defaultTier === modelId) defaultOf.push(w.label);
    }
    if (defaultOf.length > 0) {
      violations.push({
        code: "IS_DEFAULT",
        reason: `It is the default for ${defaultOf.join(", ")}. Pick another default first.`,
      });
    }

    if (toolKey === "reels" && Object.values(REELS_ENGINE_CATALOG_MODEL_ID).includes(modelId)) {
      const engineIds = Object.values(REELS_ENGINE_CATALOG_MODEL_ID);
      const offered = (set: ReadonlySet<string>) =>
        engineIds.filter((id) => resolveToolEnablement(toolKey, set, input.featureRows).get("reels-creator")!.enabledTiers.includes(id));
      if (offered(before).length > 0 && offered(after).length === 0) {
        violations.push({
          code: "REELS_ENGINE_LAST",
          reason: "It runs the last offered Reels Creator engine.",
        });
      }
    }
  } else {
    const notReady = pricingNotReadyKeys(toolKey, modelId, input.pricingRows);
    if (notReady.length > 0) {
      violations.push({
        code: "PRICING_NOT_READY",
        reason: `Pricing is not ready: ${notReady.join(", ")}.`,
      });
    }
    if (!input.provider.configured) {
      violations.push({
        code: "PROVIDER_NOT_CONFIGURED",
        reason: `Provider ${input.provider.id} is not configured on the server.`,
      });
    }
  }

  return violations.length > 0 ? fail(violations) : { ok: true, noop: false, warnings: [] };
}

export type { ModelCatalogToolKey };
