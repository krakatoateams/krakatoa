import { PRODUCT_PHOTO_TIERS } from "@/lib/product-photo";
import { VIDEO_MODELS } from "@/lib/video-models";
import { MOTION_CONTROL_MODELS } from "@/lib/motion-control-models";
import { defaultModelCatalogRows } from "@/lib/model-catalog-configs";
import { REELS_ENGINE_CATALOG_MODEL_ID } from "@/lib/reels-models";
import type { ReelsEngine } from "@/lib/reels-pipeline/types";
import { activePhotoProvider, PROVIDER_LABEL } from "@/lib/admin-provider-switch";
import { isProviderConfigured } from "@/lib/ai-provider-catalog";
import {
  checkModelCatalogChange,
  modelPricingKeys,
  pricingNotReadyKeys,
  resolveToolEnablement,
  type GuardCatalogRow,
  type GuardFeatureRow,
  type GuardPricingRow,
  type ModelCatalogGuardResult,
} from "@/lib/model-catalog-guard";

/**
 * Read-only view model for Admin Config → Models. Pure: rows in, JSON-safe payload out.
 * Provider is reported as a label + a boolean "configured" flag, never a key or env value.
 */

export type RegistryCatalogRow = GuardCatalogRow & { id: string; updated_at: string };
export type RegistryModelConfigRow = { tool_key: string; config_key: string; provider: string; model: string; enabled: boolean };

export type RegistryCheck = { ok: boolean; noop: boolean; code: string | null; reasons: string[] };

export type RegistryModel = {
  toolKey: "photo" | "reels";
  modelId: string;
  label: string;
  providerModel: string;
  catalogConfigId: string | null;
  enabled: boolean;
  updatedAt: string | null;
  /** Composers / features where the model is currently offered. */
  enabledIn: { key: string; label: string }[];
  /** Composers / features where it is the effective default. */
  defaultIn: { key: string; label: string }[];
  /** Shipped code default of any composer / feature. */
  isCodeDefault: boolean;
  reelsEngine: ReelsEngine | null;
  pricing: { ready: boolean; keys: { key: string; ready: boolean; credits: number | null }[] };
  /** Shipped dark by the developer (`offeredByDefault: false`). */
  shipsDark: boolean;
  /** Where it would appear if added now (eligible composers / features that are enabled or have no row). */
  willAppearIn: { key: string; label: string }[];
  provider: { id: string; label: string; configured: boolean };
  /** Not offered and nothing blocks offering it: phase 3 will act on this. */
  availableToAdd: boolean;
  enableCheck: RegistryCheck;
  disableCheck: RegistryCheck;
};

function summarize(r: ModelCatalogGuardResult): RegistryCheck {
  return r.ok
    ? { ok: true, noop: r.noop, code: null, reasons: [] }
    : { ok: false, noop: false, code: r.code, reasons: r.reasons };
}

function labelsFor(toolKey: "photo" | "reels", modelId: string): { label: string; providerModel: string; modelRole: string } {
  const m =
    toolKey === "photo"
      ? PRODUCT_PHOTO_TIERS.find((t) => t.id === modelId)
      : (VIDEO_MODELS.find((v) => v.id === modelId) ?? MOTION_CONTROL_MODELS.find((v) => v.id === modelId));
  return { label: m?.modelLabel ?? modelId, providerModel: m?.providerModel ?? "", modelRole: m?.modelRole ?? "" };
}

/** Provider a model runs on today (label + boolean configured flag, never a key). */
export function resolveModelProvider(
  toolKey: string,
  modelId: string,
  modelConfigs: readonly RegistryModelConfigRow[],
  configured: (provider: string) => boolean = isProviderConfigured
): { id: string; label: string; configured: boolean } {
  const { modelRole } = labelsFor(toolKey as "photo" | "reels", modelId);
  // Reels models bind to Replicate today; only Photo tiers can be switched to Fal.
  const id =
    toolKey === "photo"
      ? activePhotoProvider(modelRole, modelConfigs.find((r) => r.tool_key === "photo" && r.config_key === modelRole))
      : "replicate";
  return { id, label: PROVIDER_LABEL[id as keyof typeof PROVIDER_LABEL] ?? id, configured: configured(id) };
}

export function buildModelRegistry(input: {
  catalogRows: readonly RegistryCatalogRow[];
  featureRows: readonly GuardFeatureRow[];
  pricingRows: readonly GuardPricingRow[];
  modelConfigs: readonly RegistryModelConfigRow[];
  providerConfigured?: (provider: string) => boolean;
}): RegistryModel[] {
  const configured = input.providerConfigured ?? isProviderConfigured;
  const byCatalog = new Map(input.catalogRows.map((r) => [`${r.tool_key}:${r.model_id}`, r]));
  const out: RegistryModel[] = [];

  for (const def of defaultModelCatalogRows()) {
    const row = byCatalog.get(`${def.toolKey}:${def.modelId}`);
    const enabled = row?.enabled ?? def.enabled;
    const { label, providerModel } = labelsFor(def.toolKey, def.modelId);

    const provider = resolveModelProvider(def.toolKey, def.modelId, input.modelConfigs, configured);

    const units = resolveToolEnablement(def.toolKey, new Set(
      defaultModelCatalogRows()
        .filter((d) => d.toolKey === def.toolKey && (byCatalog.get(`${d.toolKey}:${d.modelId}`)?.enabled ?? d.enabled))
        .map((d) => d.modelId)
    ), input.featureRows);
    const enabledIn: RegistryModel["enabledIn"] = [];
    const defaultIn: RegistryModel["defaultIn"] = [];
    let isCodeDefault = false;
    for (const [key, u] of units) {
      if (u.enabledTiers.includes(def.modelId)) enabledIn.push({ key, label: u.label });
      if (u.enabledTiers.includes(def.modelId) && u.defaultTier === def.modelId) defaultIn.push({ key, label: u.label });
    }
    // Code default is independent of admin state: re-resolve against an all-offered, no-override baseline.
    const baseline = resolveToolEnablement(
      def.toolKey,
      new Set(defaultModelCatalogRows().filter((d) => d.toolKey === def.toolKey).map((d) => d.modelId)),
      []
    );
    for (const u of baseline.values()) if (u.defaultTier === def.modelId) isCodeDefault = true;

    const notReady = new Set(pricingNotReadyKeys(def.toolKey, def.modelId, input.pricingRows));
    const pricingKeys = modelPricingKeys(def.toolKey, def.modelId).map((key) => ({
      key,
      ready: !notReady.has(key),
      credits: input.pricingRows.find((p) => p.pricing_key === key)?.credit_amount ?? null,
    }));
    const offeredIds = new Set(
      defaultModelCatalogRows()
        .filter((d) => d.toolKey === def.toolKey && (d.modelId === def.modelId || (byCatalog.get(`${d.toolKey}:${d.modelId}`)?.enabled ?? d.enabled)))
        .map((d) => d.modelId)
    );
    const willAppearIn = [...resolveToolEnablement(def.toolKey, offeredIds, input.featureRows)]
      .filter(([, u]) => u.enabledTiers.includes(def.modelId))
      .map(([key, u]) => ({ key, label: u.label }));

    const guard = (change: "enable" | "disable") =>
      summarize(
        checkModelCatalogChange({
          toolKey: def.toolKey,
          modelId: def.modelId,
          change,
          catalogRows: input.catalogRows,
          featureRows: input.featureRows,
          pricingRows: input.pricingRows,
          provider: { id: provider.id, configured: provider.configured },
        })
      );
    const enableCheck = guard("enable");

    out.push({
      toolKey: def.toolKey,
      modelId: def.modelId,
      label,
      providerModel,
      catalogConfigId: row?.id ?? null,
      enabled,
      updatedAt: row?.updated_at ?? null,
      enabledIn,
      defaultIn,
      isCodeDefault,
      reelsEngine:
        (Object.entries(REELS_ENGINE_CATALOG_MODEL_ID).find(([, id]) => id === def.modelId)?.[0] as ReelsEngine | undefined) ??
        null,
      pricing: { ready: notReady.size === 0, keys: pricingKeys },
      shipsDark: !def.enabled,
      willAppearIn,
      provider,
      availableToAdd: !enabled && enableCheck.ok,
      enableCheck,
      disableCheck: guard("disable"),
    });
  }
  return out;
}
