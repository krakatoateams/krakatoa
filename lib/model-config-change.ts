import {
  catalogEnabledSet,
  checkModelCatalogChange,
  resolveToolEnablement,
  type GuardCatalogRow,
  type GuardFeatureRow,
  type GuardPricingRow,
} from "@/lib/model-catalog-guard";
import { defaultModelCatalogRows } from "@/lib/model-catalog-configs";
import { resolveModelProvider, type RegistryModelConfigRow } from "@/lib/model-registry";
import { defaultTierForFeature, isPhotoFeatureKey } from "@/lib/creation-features";
import { defaultModelForComposer, isVideoComposerKey } from "@/lib/video-composer-features";
import { REELS_ENGINE_CATALOG_MODEL_ID } from "@/lib/reels-models";

/**
 * Guarded, conflict-proof enable/disable of a model (catalog row) or a per-feature model row.
 * Transport-free: the routes pass a store (DB in production, in-memory in the self-check) and
 * return { status, body } as JSON. Every change runs the REAL guard server-side, then a
 * compare-and-set on updated_at, then a best-effort audit entry. See .scratch/model-registry/spec.md.
 */

export type CatalogRowFull = GuardCatalogRow & { id: string; updated_at: string };
export type FeatureRowFull = GuardFeatureRow & { id: string; updated_at: string };
export type FeaturePatch = { enabled?: boolean; is_default?: boolean };

export type ModelAuditEntry = {
  actorProfileId: string;
  action:
    | "model_enable"
    | "model_add"
    | "model_disable"
    | "model_archive"
    | "model_restore"
    | "feature_model_update"
    | "feature_model_reset";
  toolKey: string;
  /** modelId, or featureKey:modelId for feature rows. */
  configKey: string;
  before: Record<string, boolean>;
  after: Record<string, boolean>;
};

export type ModelChangeStore = {
  listCatalog(): Promise<CatalogRowFull[]>;
  listFeatureRows(): Promise<FeatureRowFull[]>;
  listPricing(): Promise<GuardPricingRow[]>;
  listModelConfigs(): Promise<RegistryModelConfigRow[]>;
  providerConfigured(provider: string): boolean;
  /** Atomic `update ... where id = :id and updated_at = :expected`; null when nothing matched. */
  casCatalog(id: string, enabled: boolean, expectedUpdatedAt: string, actor: string): Promise<CatalogRowFull | null>;
  casFeature(id: string, patch: FeaturePatch, expectedUpdatedAt: string, actor: string): Promise<FeatureRowFull | null>;
  /** True once migration 118 is applied (column probe, never throws). */
  archiveAvailable(): Promise<boolean>;
  /** Atomic archive/restore; null when nothing matched; throws when the 118 columns turn out to be missing. */
  casArchive(id: string, archive: boolean, expectedUpdatedAt: string, actor: string): Promise<CatalogRowFull | null>;
  /** Count of queued/running/recoverable jobs on the model's provider slugs; null when unknown. Best-effort. */
  inFlightJobs?(toolKey: string, modelId: string): Promise<number | null>;
  /** True when an enable/add audit row exists; null when that cannot be determined (then `model_enable` is used). */
  everOffered?(toolKey: string, modelId: string): Promise<boolean | null>;
  /** Best-effort: must never throw into the change. */
  audit(entry: ModelAuditEntry): Promise<void>;
};

export type ChangeResponse = { status: number; body: Record<string, unknown> };

const shippedDark = (toolKey: string, modelId: string) =>
  defaultModelCatalogRows().some((d) => d.toolKey === toolKey && d.modelId === modelId && !d.enabled);

const STALE_MESSAGE = "Someone else changed this model. Review and try again.";

const reject = (code: string, reasons: string[], extra: Record<string, unknown> = {}, codes: string[] = [code]): ChangeResponse => ({
  status: 409,
  body: { error: reasons[0] ?? code, code, codes, reasons, ...extra },
});

const MIGRATION_MESSAGE = "Run migration 118 to enable archiving";

export async function applyCatalogToggle(
  store: ModelChangeStore,
  input: { id: string; enabled: boolean; expectedUpdatedAt: unknown; actorProfileId: string }
): Promise<ChangeResponse> {
  if (typeof input.expectedUpdatedAt !== "string" || input.expectedUpdatedAt === "") {
    return { status: 400, body: { error: "`expectedUpdatedAt` must be the row's last known updated_at." } };
  }
  const catalogRows = await store.listCatalog();
  const row = catalogRows.find((r) => r.id === input.id);
  if (!row) return { status: 404, body: { error: "Model catalog config not found." } };

  const change = input.enabled ? "enable" : "disable";
  // Pricing / provider only matter when offering a model; hiding one never needs them.
  const [pricingRows, modelConfigs, featureRows] = await Promise.all([
    input.enabled ? store.listPricing() : Promise.resolve([]),
    input.enabled ? store.listModelConfigs() : Promise.resolve([]),
    store.listFeatureRows(),
  ]);
  const provider = resolveModelProvider(row.tool_key, row.model_id, modelConfigs, store.providerConfigured);

  const verdict = checkModelCatalogChange({
    toolKey: row.tool_key,
    modelId: row.model_id,
    change,
    catalogRows,
    featureRows,
    pricingRows,
    provider: { id: provider.id, configured: provider.configured },
  });
  if (!verdict.ok) return reject(verdict.code, verdict.reasons, { modelCatalog: row }, verdict.codes);
  // Same target state (double submit, retry): success without a write or audit row, even if stale.
  if (verdict.noop) return { status: 200, body: { modelCatalog: row, noop: true, warnings: verdict.warnings } };

  const updated = await store.casCatalog(row.id, input.enabled, input.expectedUpdatedAt, input.actorProfileId);
  if (!updated) {
    const current = (await store.listCatalog()).find((r) => r.id === row.id) ?? null;
    return reject("STALE_MODEL_CONFIG", [STALE_MESSAGE], { modelCatalog: current });
  }
  // First offer of a model shipped dark is an "add"; anything else (or anything unknown) is an enable.
  let action: ModelAuditEntry["action"] = input.enabled ? "model_enable" : "model_disable";
  if (input.enabled && shippedDark(row.tool_key, row.model_id)) {
    const offered = await store.everOffered?.(row.tool_key, row.model_id).catch(() => null);
    if (offered === false) action = "model_add";
  }
  await store.audit({
    actorProfileId: input.actorProfileId,
    action,
    toolKey: row.tool_key,
    configKey: row.model_id,
    before: { enabled: row.enabled },
    after: { enabled: updated.enabled },
  });
  return { status: 200, body: { modelCatalog: updated, noop: false, warnings: verdict.warnings } };
}

/** Archive ("Remove") or restore a model: guarded, CAS on updated_at, idempotent, audited. Inert without migration 118. */
export async function applyCatalogArchive(
  store: ModelChangeStore,
  input: { id: string; archive: boolean; expectedUpdatedAt: unknown; actorProfileId: string }
): Promise<ChangeResponse> {
  if (typeof input.expectedUpdatedAt !== "string" || input.expectedUpdatedAt === "") {
    return { status: 400, body: { error: "`expectedUpdatedAt` must be the row's last known updated_at." } };
  }
  const migrationRequired = (): ChangeResponse => reject("MIGRATION_REQUIRED", [MIGRATION_MESSAGE]);
  if (!(await store.archiveAvailable())) return migrationRequired();

  const catalogRows = await store.listCatalog();
  const row = catalogRows.find((r) => r.id === input.id);
  if (!row) return { status: 404, body: { error: "Model catalog config not found." } };

  const [featureRows, modelConfigs] = await Promise.all([store.listFeatureRows(), store.listModelConfigs()]);
  const provider = resolveModelProvider(row.tool_key, row.model_id, modelConfigs, store.providerConfigured);
  const verdict = checkModelCatalogChange({
    toolKey: row.tool_key,
    modelId: row.model_id,
    change: input.archive ? "archive" : "restore",
    catalogRows,
    featureRows,
    pricingRows: [],
    provider: { id: provider.id, configured: provider.configured },
  });
  if (!verdict.ok) return reject(verdict.code, verdict.reasons, { modelCatalog: row }, verdict.codes);

  const warnings = [...verdict.warnings];
  if (input.archive) {
    const running = await store.inFlightJobs?.(row.tool_key, row.model_id).catch(() => null);
    if (running) {
      warnings.push(`${running} ${running === 1 ? "job is" : "jobs are"} still running on this model. They will finish normally.`);
    }
  }
  if (verdict.noop) return { status: 200, body: { modelCatalog: row, noop: true, warnings } };

  let updated: CatalogRowFull | null;
  try {
    updated = await store.casArchive(row.id, input.archive, input.expectedUpdatedAt, input.actorProfileId);
  } catch (e) {
    if (e instanceof Error && e.name === "ArchiveMigrationRequiredError") return migrationRequired();
    throw e;
  }
  if (!updated) {
    const current = (await store.listCatalog()).find((r) => r.id === row.id) ?? null;
    return reject("STALE_MODEL_CONFIG", [STALE_MESSAGE], { modelCatalog: current });
  }
  await store.audit({
    actorProfileId: input.actorProfileId,
    action: input.archive ? "model_archive" : "model_restore",
    toolKey: row.tool_key,
    configKey: row.model_id,
    before: { enabled: row.enabled, archived: !!row.archived_at },
    after: { enabled: updated.enabled, archived: !!updated.archived_at },
  });
  return { status: 200, body: { modelCatalog: updated, noop: false, warnings } };
}

/** Guard for one per-feature row: never leave a feature with no model, never drop its default silently. */
export function checkFeatureModelChange(input: {
  row: FeatureRowFull;
  patch: FeaturePatch;
  catalogRows: readonly GuardCatalogRow[];
  featureRows: readonly GuardFeatureRow[];
}): { ok: true; noop: boolean } | { ok: false; code: "LAST_ENABLED_MODEL" | "IS_DEFAULT" | "REELS_ENGINE_LAST"; reasons: string[] } {
  const { row, patch } = input;
  const nextEnabled = patch.enabled ?? row.enabled;
  const nextDefault = patch.is_default ?? row.is_default;
  if (nextEnabled === row.enabled && nextDefault === row.is_default) return { ok: true, noop: true };

  const same = (r: GuardFeatureRow) => r.tool_key === row.tool_key && r.feature_key === row.feature_key;
  const after = input.featureRows.map((r) => {
    if (r.model_tier === row.model_tier && same(r)) return { ...r, enabled: nextEnabled, is_default: nextDefault };
    // Setting a default clears the previous one (single default per feature).
    return nextDefault && !row.is_default && same(r) ? { ...r, is_default: false } : r;
  });
  const catalogEnabled = catalogEnabledSet(row.tool_key, input.catalogRows);
  const was = resolveToolEnablement(row.tool_key, catalogEnabled, input.featureRows).get(row.feature_key);
  const now = resolveToolEnablement(row.tool_key, catalogEnabled, after).get(row.feature_key);
  if (!was || !now) return { ok: true, noop: false };

  if (was.enabledTiers.length > 0 && now.enabledTiers.length === 0) {
    return { ok: false, code: "LAST_ENABLED_MODEL", reasons: [`It is the last enabled model for ${was.label}.`] };
  }
  // Reels Creator needs at least one engine: hiding the last engine row leaves the composer with none.
  if (row.tool_key === "reels" && row.feature_key === "reels-creator") {
    const engines = new Set<string>(Object.values(REELS_ENGINE_CATALOG_MODEL_ID));
    const offered = (tiers: string[]) => tiers.filter((t) => engines.has(t)).length;
    if (offered(was.enabledTiers) > 0 && offered(now.enabledTiers) === 0) {
      return { ok: false, code: "REELS_ENGINE_LAST", reasons: ["It runs the last offered Reels Creator engine."] };
    }
  }
  if (was.defaultTier === row.model_tier && was.enabledTiers.includes(row.model_tier) && now.defaultTier !== row.model_tier) {
    return {
      ok: false,
      code: "IS_DEFAULT",
      reasons: [`It is the default for ${was.label}. Pick another default first.`],
    };
  }
  return { ok: true, noop: false };
}

/** Shared flow for a per-feature row write: guard, noop, CAS, audit. */
async function applyFeatureRowPatch(
  store: ModelChangeStore,
  input: { id: string; patch: FeaturePatch; expectedUpdatedAt: unknown; actorProfileId: string },
  action: "feature_model_update" | "feature_model_reset"
): Promise<ChangeResponse> {
  if (typeof input.expectedUpdatedAt !== "string" || input.expectedUpdatedAt === "") {
    return { status: 400, body: { error: "`expectedUpdatedAt` must be the row's last known updated_at." } };
  }
  const [featureRows, catalogRows] = await Promise.all([store.listFeatureRows(), store.listCatalog()]);
  const row = featureRows.find((r) => r.id === input.id);
  if (!row) return { status: 404, body: { error: "Feature model config not found." } };

  const verdict = checkFeatureModelChange({ row, patch: input.patch, catalogRows, featureRows });
  if (!verdict.ok) return reject(verdict.code, verdict.reasons, { featureModel: row });
  if (verdict.noop) return { status: 200, body: { featureModel: row, noop: true } };

  const updated = await store.casFeature(row.id, input.patch, input.expectedUpdatedAt, input.actorProfileId);
  if (!updated) {
    const current = (await store.listFeatureRows()).find((r) => r.id === row.id) ?? null;
    return reject("STALE_MODEL_CONFIG", [STALE_MESSAGE], { featureModel: current });
  }
  await store.audit({
    actorProfileId: input.actorProfileId,
    action,
    toolKey: row.tool_key,
    configKey: `${row.feature_key}:${row.model_tier}`,
    before: { enabled: row.enabled, is_default: row.is_default },
    after: { enabled: updated.enabled, is_default: updated.is_default },
  });
  return { status: 200, body: { featureModel: updated, noop: false } };
}

export const applyFeatureModelChange = (
  store: ModelChangeStore,
  input: { id: string; patch: FeaturePatch; expectedUpdatedAt: unknown; actorProfileId: string }
) => applyFeatureRowPatch(store, input, "feature_model_update");

/** Shipped default of a feature row: enabled, and the default flag follows the code catalog. */
export function shippedFeaturePatch(row: { tool_key: string; feature_key: string; model_tier: string }): Required<FeaturePatch> {
  const isDefault =
    row.tool_key === "photo"
      ? isPhotoFeatureKey(row.feature_key) && defaultTierForFeature(row.feature_key) === row.model_tier
      : row.tool_key === "reels" && isVideoComposerKey(row.feature_key) && defaultModelForComposer(row.feature_key) === row.model_tier;
  return { enabled: true, is_default: isDefault };
}

/** Reset a feature row to its shipped default through the same guard, CAS and audit as a normal edit. */
export async function applyFeatureModelReset(
  store: ModelChangeStore,
  input: { id: string; expectedUpdatedAt: unknown; actorProfileId: string }
): Promise<ChangeResponse> {
  const row = (await store.listFeatureRows()).find((r) => r.id === input.id);
  if (!row) return { status: 404, body: { error: "Feature model config not found." } };
  return applyFeatureRowPatch(store, { ...input, patch: shippedFeaturePatch(row) }, "feature_model_reset");
}
