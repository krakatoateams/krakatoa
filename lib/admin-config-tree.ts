/**
 * Admin Config v2 tree builder — merges DB rows with code registries (video-models,
 * product-photo, creation-features) into the tool → model → composers → variants tree.
 */

import {
  PHOTO_FEATURES,
  defaultFeatureModelRows,
  defaultTierForFeature,
  eligibleTiersForFeature,
  type PhotoFeatureKey,
} from "@/lib/creation-features";
import {
  MOTION_CONTROL_MODELS,
  type MotionControlModel,
} from "@/lib/motion-control-models";
import {
  PRODUCT_PHOTO_TIERS,
  type ProductPhotoModelTier,
  type ProductPhotoTier,
} from "@/lib/product-photo";
import {
  type BillingSettings,
  type CostUnit,
  calculateCredits,
} from "@/lib/pricing-math";
import {
  activePhotoProvider,
  photoProviderOptions,
  type PhotoProviderId,
  type PhotoProviderOption,
} from "@/lib/admin-provider-switch";
import { getModelDefault } from "@/lib/admin-config-resolved-defaults";
import { defaultModelCatalogRows } from "@/lib/model-catalog-configs";
import { PIPELINE_GROUP_SPECS, type PipelineRoleSpec } from "@/lib/admin-pipeline-config";
import { getV2PricingDefault } from "@/lib/pricing-defaults";
import {
  VIDEO_COMPOSER_FEATURES,
  defaultVideoComposerRows,
  modelEligibleForComposer,
} from "@/lib/video-composer-features";
import { photoTierPricingEntries, videoPricingContexts } from "@/lib/model-pricing-keys";
import {
  STORYBOARD_VIDEO_MODEL_IDS,
  VIDEO_MODELS,
  type VideoModel,
  type VideoPricingContext,
} from "@/lib/video-models";

// ---------------------------------------------------------------------------
// Shared tree types (consumed by admin config v2 UI)
// ---------------------------------------------------------------------------

export type AdminFeatureToggle = {
  key: string;
  label: string;
  enabled: boolean;
  isDefault: boolean;
  /** Present when persisted (Photo + Video composers). */
  featureModelId?: string;
  /** updated_at of the persisted row: the compare-and-set token for saves. */
  updatedAt?: string;
  /** Hard capability gate — cannot enable even if admin tries. */
  eligible: boolean;
};

export type AdminCostVariant = {
  pricingKey: string;
  label: string;
  credits: number;
  providerReferenceUsd: number;
  costUnit: CostUnit;
  enabled: boolean;
};

/** Photo tiers only: the provider this tier runs on and the catalog choices for it. */
export type AdminProviderChoice = {
  configKey: string;
  modelConfigId?: string;
  provider: PhotoProviderId;
  /** False when the model_configs row is disabled: the resolver ignores it, so a switch has no effect. */
  rowEnabled?: boolean;
  options: PhotoProviderOption[];
};

export type AdminModelNode = {
  id: string;
  label: string;
  subtitle: string;
  /** Catalog on/off — hides model from studio when false. */
  enabled: boolean;
  /** Removed from the tool (catalog row archived, migration 118). Never shown in the tool's list. */
  archived: boolean;
  catalogConfigId?: string;
  /** updated_at of the catalog row: the compare-and-set token for on/off saves. */
  catalogUpdatedAt?: string;
  features: AdminFeatureToggle[];
  variants: AdminCostVariant[];
  providerChoice?: AdminProviderChoice;
};

export type AdminPipelineRole = {
  modelConfigToolKey: string;
  configKey: string;
  label: string;
  description?: string;
  provider: string;
  model: string;
  enabled: boolean;
  modelConfigId?: string;
};

export type AdminPipelineGroup = {
  key: string;
  label: string;
  description?: string;
  roles: AdminPipelineRole[];
  variants: AdminCostVariant[];
};

export type AdminToolNode = {
  toolKey: string;
  label: string;
  enabled: boolean;
  visibleInSidebar: boolean;
  comingSoon: boolean;
  sortOrder: number;
  models: AdminModelNode[];
  pipelines: AdminPipelineGroup[];
};

// ---------------------------------------------------------------------------
// Input shapes (from admin APIs)
// ---------------------------------------------------------------------------

export type ToolConfigInput = {
  tool_key: string;
  display_name: string;
  enabled: boolean;
  visible_in_sidebar: boolean;
  coming_soon: boolean;
  sort_order: number;
};

export type PricingConfigInput = {
  pricing_key: string;
  display_name: string;
  credit_amount: number;
  enabled: boolean;
  provider_cost_usd: number | null;
  cost_unit: CostUnit | null;
  is_deprecated: boolean;
};

export type FeatureModelInput = {
  id: string;
  tool_key: string;
  feature_key: string;
  model_tier: string;
  enabled: boolean;
  is_default: boolean;
  updated_at?: string;
};

export type ModelCatalogInput = {
  id: string;
  tool_key: string;
  model_id: string;
  enabled: boolean;
  updated_at?: string;
  /** Present only after migration 118; absent/null = not archived. */
  archived_at?: string | null;
};

export type ModelConfigInput = {
  id: string;
  tool_key: string;
  config_key: string;
  provider: string;
  model: string;
  enabled: boolean;
};

function pricingMap(rows: PricingConfigInput[]): Map<string, PricingConfigInput> {
  return new Map(rows.map((r) => [r.pricing_key, r]));
}

function suggestCredits(providerUsd: number, settings: BillingSettings): number {
  return calculateCredits({ providerCostUsd: providerUsd, unitCount: 1, settings });
}

export function variantFromPricingRow(
  pricingKey: string,
  label: string,
  map: Map<string, PricingConfigInput>,
  settings: BillingSettings
): AdminCostVariant | null {
  const row = map.get(pricingKey);
  if (row?.is_deprecated) return null;

  if (row?.cost_unit) {
    const providerReferenceUsd = row.provider_cost_usd ?? 0;
    return {
      pricingKey,
      label,
      credits:
        Number.isInteger(row.credit_amount) && row.credit_amount >= 0
          ? row.credit_amount
          : suggestCredits(providerReferenceUsd, settings),
      providerReferenceUsd,
      costUnit: row.cost_unit,
      enabled: row.enabled,
    };
  }

  // ponytail: code-only pricing keys (extended photo models) may lack DB rows — mirror runtime resolver.
  const builtin = getV2PricingDefault(pricingKey);
  if (!builtin) return null;
  const providerReferenceUsd = builtin.providerCostUsd;
  return {
    pricingKey,
    label,
    credits: suggestCredits(providerReferenceUsd, settings),
    providerReferenceUsd,
    costUnit: builtin.costUnit,
    enabled: row?.enabled ?? true,
  };
}

function humanVideoVariantLabel(model: VideoModel, ctx: VideoPricingContext): string {
  const parts: string[] = [];
  if (ctx.resolution) parts.push(String(ctx.resolution));
  if (model.supportsAudio) {
    parts.push(ctx.generateAudio ? "with audio" : "without audio");
  }
  if (ctx.hasReferenceVideo) parts.push("reference video");
  return parts.join(" · ") || "Default";
}

function enumerateVideoVariants(
  model: VideoModel,
  map: Map<string, PricingConfigInput>,
  settings: BillingSettings
): AdminCostVariant[] {
  const seen = new Map<string, string>();
  for (const ctx of videoPricingContexts(model)) {
    const key = model.pricingKey(ctx);
    if (!seen.has(key)) seen.set(key, humanVideoVariantLabel(model, ctx));
  }

  const variants: AdminCostVariant[] = [];
  for (const [pricingKey, label] of Array.from(seen.entries())) {
    const v = variantFromPricingRow(pricingKey, label, map, settings);
    if (v) variants.push(v);
  }
  return variants;
}

function enumerateMotionVariants(
  model: MotionControlModel,
  map: Map<string, PricingConfigInput>,
  settings: BillingSettings
): AdminCostVariant[] {
  const variants: AdminCostVariant[] = [];
  for (const mode of model.modes) {
    const pricingKey = model.pricingKey(mode);
    const label = mode === "std" ? "Standard (720p)" : "Pro (1080p)";
    const v = variantFromPricingRow(pricingKey, label, map, settings);
    if (v) variants.push(v);
  }
  return variants;
}

function buildVideoFeatures(
  modelId: string,
  featureModels: FeatureModelInput[]
): AdminFeatureToggle[] {
  const defaults = defaultVideoComposerRows();

  return VIDEO_COMPOSER_FEATURES.filter((composer) =>
    modelEligibleForComposer(modelId, composer.key)
  ).map((composer) => {
    const dbRow = featureModels.find(
      (r) =>
        r.tool_key === "reels" &&
        r.feature_key === composer.key &&
        r.model_tier === modelId
    );
    const def = defaults.find((d) => d.featureKey === composer.key && d.modelTier === modelId);

    return {
      key: composer.key,
      label: composer.label,
      enabled: dbRow?.enabled ?? def?.enabled ?? true,
      isDefault: dbRow?.is_default ?? def?.isDefault ?? false,
      featureModelId: dbRow?.id,
      updatedAt: dbRow?.updated_at,
      eligible: true,
    };
  });
}

/**
 * One default model per mode (feature key) across the whole tool. Each model used to
 * mark its primary mode as default independently — this normalizes after the tree is built.
 */
function normalizeDefaultsPerMode(all: AdminModelNode[]): AdminModelNode[] {
  // A removed model is never a mode's default.
  const models = all.filter((m) => !m.archived);
  const modeKeys = new Set<string>();
  for (const m of models) {
    for (const f of m.features) {
      if (f.enabled) modeKeys.add(f.key);
    }
  }

  const defaultModelByMode = new Map<string, string>();

  for (const modeKey of Array.from(modeKeys)) {
    const holders: { modelId: string; order: number }[] = [];
    models.forEach((m, order) => {
      const f = m.features.find((row) => row.key === modeKey && row.enabled);
      if (f?.isDefault) holders.push({ modelId: m.id, order });
    });

    if (holders.length === 1) {
      defaultModelByMode.set(modeKey, holders[0].modelId);
      continue;
    }

    if (holders.length > 1) {
      holders.sort((a, b) => a.order - b.order);
      defaultModelByMode.set(modeKey, holders[0].modelId);
      continue;
    }

    const first = models.find((m) => m.features.some((f) => f.key === modeKey && f.enabled));
    if (first) defaultModelByMode.set(modeKey, first.id);
  }

  return all.map((m) => ({
    ...m,
    features: m.features.map((f) => ({
      ...f,
      isDefault: defaultModelByMode.get(f.key) === m.id,
    })),
  }));
}

function buildPhotoFeatures(
  tierId: ProductPhotoModelTier,
  featureModels: FeatureModelInput[]
): AdminFeatureToggle[] {
  const defaults = defaultFeatureModelRows();

  return PHOTO_FEATURES.filter((feature) => eligibleTiersForFeature(feature.key).includes(tierId)).map(
    (feature) => {
      const dbRow = featureModels.find(
        (r) => r.tool_key === "photo" && r.feature_key === feature.key && r.model_tier === tierId
      );
      const def = defaults.find((d) => d.featureKey === feature.key && d.modelTier === tierId);

      return {
        key: feature.key,
        label: feature.label,
        enabled: dbRow?.enabled ?? def?.enabled ?? true,
        isDefault: dbRow?.is_default ?? def?.isDefault ?? tierId === defaultTierForFeature(feature.key),
        featureModelId: dbRow?.id,
      updatedAt: dbRow?.updated_at,
        eligible: true,
      };
    }
  );
}

function enumeratePhotoVariants(
  tier: ProductPhotoTier,
  map: Map<string, PricingConfigInput>,
  settings: BillingSettings
): AdminCostVariant[] {
  return photoTierPricingEntries(tier)
    .map((e) => variantFromPricingRow(e.pricingKey, e.label, map, settings))
    .filter((v): v is AdminCostVariant => v !== null);
}

function resolveCatalogModel(
  toolKey: string,
  modelId: string,
  modelCatalog: ModelCatalogInput[]
): { enabled: boolean; archived: boolean; catalogConfigId?: string; catalogUpdatedAt?: string } {
  const row = modelCatalog.find((r) => r.tool_key === toolKey && r.model_id === modelId);
  // A missing row means the shipped default (ship dark unless offered by default), like the runtime.
  const shipped = defaultModelCatalogRows().find((d) => d.toolKey === toolKey && d.modelId === modelId);
  const archived = !!row?.archived_at;
  return {
    enabled: !archived && (row?.enabled ?? shipped?.enabled ?? false),
    archived,
    catalogConfigId: row?.id,
    catalogUpdatedAt: row?.updated_at,
  };
}

/**
 * A model with no live price rows is left out of the tree, except a removed one: retiring a model
 * deprecates its prices, and it must still show under "Restore model" (blocked until priced again).
 */
function listedInTree(variants: readonly AdminCostVariant[], catalog: { archived: boolean }): boolean {
  return variants.length > 0 || catalog.archived;
}

function buildVideoModels(
  map: Map<string, PricingConfigInput>,
  settings: BillingSettings,
  featureModels: FeatureModelInput[],
  modelCatalog: ModelCatalogInput[]
): AdminModelNode[] {
  const models: AdminModelNode[] = [];

  for (const model of VIDEO_MODELS) {
    const variants = enumerateVideoVariants(model, map, settings);
    const catalog = resolveCatalogModel("reels", model.id, modelCatalog);
    if (!listedInTree(variants, catalog)) continue;
    models.push({
      id: model.id,
      label: model.modelLabel,
      subtitle: model.providerModel,
      ...catalog,
      features: buildVideoFeatures(model.id, featureModels),
      variants,
    });
  }

  for (const model of MOTION_CONTROL_MODELS) {
    const variants = enumerateMotionVariants(model, map, settings);
    const catalog = resolveCatalogModel("reels", model.id, modelCatalog);
    if (!listedInTree(variants, catalog)) continue;
    models.push({
      id: model.id,
      label: model.modelLabel,
      subtitle: model.providerModel,
      ...catalog,
      features: buildVideoFeatures(model.id, featureModels),
      variants,
    });
  }

  return normalizeDefaultsPerMode(models);
}

function buildProviderChoice(configKey: string, modelConfigs: ModelConfigInput[]): AdminProviderChoice {
  const row = modelConfigs.find((r) => r.tool_key === "photo" && r.config_key === configKey);
  return {
    configKey,
    modelConfigId: row?.id,
    provider: activePhotoProvider(configKey, row),
    rowEnabled: row ? row.enabled : true,
    options: photoProviderOptions(configKey),
  };
}

function buildPhotoModels(
  map: Map<string, PricingConfigInput>,
  settings: BillingSettings,
  featureModels: FeatureModelInput[],
  modelCatalog: ModelCatalogInput[],
  modelConfigs: ModelConfigInput[]
): AdminModelNode[] {
  return normalizeDefaultsPerMode(
    PRODUCT_PHOTO_TIERS.map((tier) => ({
      providerChoice: buildProviderChoice(tier.modelRole, modelConfigs),
      id: tier.id,
      label: tier.modelLabel,
      subtitle: tier.providerModel,
      ...resolveCatalogModel("photo", tier.id, modelCatalog),
      features: buildPhotoFeatures(tier.id, featureModels),
      variants: enumeratePhotoVariants(tier, map, settings),
    })).filter((m) => listedInTree(m.variants, m))
  );
}

function resolvePipelineRole(
  spec: PipelineRoleSpec,
  modelConfigs: ModelConfigInput[]
): AdminPipelineRole {
  const dbRow = modelConfigs.find(
    (r) => r.tool_key === spec.modelConfigToolKey && r.config_key === spec.configKey
  );
  const def = getModelDefault(spec.modelConfigToolKey, spec.configKey);

  return {
    modelConfigToolKey: spec.modelConfigToolKey,
    configKey: spec.configKey,
    label: spec.label,
    description: spec.description,
    provider: dbRow?.provider ?? def?.provider ?? "—",
    model: dbRow?.model ?? def?.model ?? "—",
    enabled: dbRow?.enabled ?? def?.enabled ?? true,
    modelConfigId: dbRow?.id,
  };
}

function buildPipelineGroupsForTool(
  adminToolKey: string,
  modelConfigs: ModelConfigInput[],
  pricingMap: Map<string, PricingConfigInput>,
  billingSettings: BillingSettings
): AdminPipelineGroup[] {
  return PIPELINE_GROUP_SPECS.filter((g) => g.adminToolKey === adminToolKey).map((spec) => {
    const variants: AdminCostVariant[] = [];
    for (const row of spec.pricingKeys ?? []) {
      const v = variantFromPricingRow(row.pricingKey, row.label, pricingMap, billingSettings);
      if (v) variants.push(v);
    }

    return {
      key: spec.key,
      label: spec.label,
      description: spec.description,
      roles: spec.roles.map((role) => resolvePipelineRole(role, modelConfigs)),
      variants,
    };
  });
}

const MODEL_BUILDERS: Record<
  string,
  (
    map: Map<string, PricingConfigInput>,
    settings: BillingSettings,
    featureModels: FeatureModelInput[],
    modelCatalog: ModelCatalogInput[],
    modelConfigs: ModelConfigInput[]
  ) => AdminModelNode[]
> = {
  reels: (map, settings, featureModels, modelCatalog) =>
    buildVideoModels(map, settings, featureModels, modelCatalog),
  photo: (map, settings, featureModels, modelCatalog, modelConfigs) =>
    buildPhotoModels(map, settings, featureModels, modelCatalog, modelConfigs),
};

export function buildAdminConfigTree(params: {
  tools: ToolConfigInput[];
  pricing: PricingConfigInput[];
  featureModels: FeatureModelInput[];
  modelCatalog: ModelCatalogInput[];
  modelConfigs: ModelConfigInput[];
  billingSettings: BillingSettings;
}): AdminToolNode[] {
  const pmap = pricingMap(params.pricing);

  return [...params.tools]
    .sort((a, b) => a.sort_order - b.sort_order || a.tool_key.localeCompare(b.tool_key))
    .map((tool) => {
      const toolKey = tool.tool_key;
      const buildModels = MODEL_BUILDERS[toolKey];
      const models = buildModels
        ? buildModels(pmap, params.billingSettings, params.featureModels, params.modelCatalog, params.modelConfigs)
        : [];

      const pipelines =
        toolKey === "reels" || toolKey === "photo" || toolKey === "schedule"
          ? buildPipelineGroupsForTool(toolKey, params.modelConfigs, pmap, params.billingSettings)
          : [];

      return {
        toolKey,
        label: tool.display_name,
        enabled: tool.enabled,
        visibleInSidebar: tool.visible_in_sidebar,
        comingSoon: tool.coming_soon,
        sortOrder: tool.sort_order,
        models,
        pipelines,
      };
    });
}

/**
 * A tool's model list (Models tab) and its "Restore model" picker, from the same catalog rows: a removed
 * (archived) model is only in the picker, so it can never linger in the list after Remove (#460).
 */
export function splitToolModels(models: readonly AdminModelNode[]): {
  inTool: AdminModelNode[];
  removed: AdminModelNode[];
} {
  return {
    inTool: models.filter((m) => !m.archived),
    removed: models.filter((m) => m.archived),
  };
}

/** Tools listed in the Models tab: every tool with a model list or a pipeline (#466). */
export function modelsTabTools(tools: readonly AdminToolNode[]): AdminToolNode[] {
  return tools.filter((t) => t.models.length > 0 || t.pipelines.length > 0);
}

const PRICE_UNIT_TEXT: Partial<Record<CostUnit, string>> = {
  per_image: "per image",
  per_second: "per second",
  per_run: "per run",
};

/**
 * Read-only price for a model row, from the SAVED credits (what users pay now, not an unsaved
 * draft): "10 credits per image", or a range over the variants that are on ("8–14 credits per image").
 */
export function priceSummary(
  variants: readonly AdminCostVariant[],
  saved: Readonly<Record<string, { credits: number }>>
): string | null {
  const on = variants.filter((v) => v.enabled);
  const rows = on.length > 0 ? on : variants;
  if (rows.length === 0) return null;
  const credits = rows.map((v) => saved[v.pricingKey]?.credits ?? v.credits);
  const min = Math.min(...credits);
  const max = Math.max(...credits);
  const units = new Set(rows.map((v) => v.costUnit));
  const unit = units.size === 1 ? (PRICE_UNIT_TEXT[rows[0].costUnit] ?? "") : "";
  const amount = min === max ? `${min}` : `${min}–${max}`;
  return `${amount} ${max === 1 ? "credit" : "credits"} ${unit}`.trim();
}

export type PricingBaseline = Pick<AdminCostVariant, "providerReferenceUsd" | "credits">;

function allVariants(tools: readonly AdminToolNode[]): AdminCostVariant[] {
  return tools.flatMap((t) => [...t.models.flatMap((m) => m.variants), ...t.pipelines.flatMap((g) => g.variants)]);
}

/** Last saved (server) price per pricing key; a row differing from it has an unsaved draft. */
export function collectPricingBaselines(tools: readonly AdminToolNode[]): Record<string, PricingBaseline> {
  const out: Record<string, PricingBaseline> = {};
  for (const v of allVariants(tools)) {
    out[v.pricingKey] = { providerReferenceUsd: v.providerReferenceUsd, credits: v.credits };
  }
  return out;
}

export function isPricingDirty(variant: AdminCostVariant, saved: Record<string, PricingBaseline>): boolean {
  const baseline = saved[variant.pricingKey];
  if (!baseline) return true;
  return baseline.providerReferenceUsd !== variant.providerReferenceUsd || baseline.credits !== variant.credits;
}

/**
 * A refreshed tree that keeps every unsaved price draft (#484): a row dirty against `prevSaved` keeps its
 * typed cost and credits; clean rows and every other field take the fresh server values. Rows in
 * `staleKeys` (saved after this refresh started, #487) also keep their current price, and rows in
 * `staleFlagKeys` (toggled after it started, #490) keep their current On/Off. The caller takes the new
 * baselines from `refreshedBaselines`, so a kept draft still shows as unsaved.
 */
export function keepPricingDrafts(
  next: AdminToolNode[],
  prev: readonly AdminToolNode[],
  prevSaved: Record<string, PricingBaseline>,
  staleKeys: ReadonlySet<string> = new Set(),
  staleFlagKeys: ReadonlySet<string> = new Set()
): AdminToolNode[] {
  const kept = new Map<string, Partial<AdminCostVariant>>();
  for (const v of allVariants(prev)) {
    const current: Partial<AdminCostVariant> = {};
    if (staleKeys.has(v.pricingKey) || (prevSaved[v.pricingKey] && isPricingDirty(v, prevSaved))) {
      current.providerReferenceUsd = v.providerReferenceUsd;
      current.credits = v.credits;
    }
    if (staleFlagKeys.has(v.pricingKey)) current.enabled = v.enabled;
    if (Object.keys(current).length > 0) kept.set(v.pricingKey, current);
  }
  if (kept.size === 0) return next;
  const keep = (variants: AdminCostVariant[]) =>
    variants.map((v) => {
      const row = kept.get(v.pricingKey);
      return row ? { ...v, ...row } : v;
    });
  return next.map((t) => ({
    ...t,
    models: t.models.map((m) => ({ ...m, variants: keep(m.variants) })),
    pipelines: t.pipelines.map((g) => ({ ...g, variants: keep(g.variants) })),
  }));
}

/** Baselines after a refresh: the server's, except a stale row (#487) keeps its last saved price. */
export function refreshedBaselines(
  next: readonly AdminToolNode[],
  prevSaved: Record<string, PricingBaseline>,
  staleKeys: ReadonlySet<string>
): Record<string, PricingBaseline> {
  const out = collectPricingBaselines(next);
  for (const key of staleKeys) if (prevSaved[key]) out[key] = prevSaved[key];
  return out;
}

/**
 * Orders refreshes against price saves (#487) and On/Off toggles (#490). A refresh that started before a
 * row's last successful Save, or before its last toggle, read that row's old value, so its data for that
 * value is stale and must be discarded.
 */
export function createPriceSaveTracker() {
  let refreshSeq = 0;
  const savedAtSeq = new Map<string, number>();
  const toggledAtSeq = new Map<string, number>();
  const since = (marks: Map<string, number>, seq: number) =>
    new Set([...marks].filter(([, markedAt]) => seq <= markedAt).map(([key]) => key));
  return {
    /** When a refresh starts; hand the number to `staleKeys` / `staleFlagKeys` when it resolves. */
    beginRefresh: (): number => ++refreshSeq,
    /** After a Save of this pricing key succeeded. */
    markSaved: (pricingKey: string): void => {
      savedAtSeq.set(pricingKey, refreshSeq);
    },
    /** When the admin flips this row's On/Off (the UI already shows the new value). */
    markToggled: (pricingKey: string): void => {
      toggledAtSeq.set(pricingKey, refreshSeq);
    },
    /** Keys whose price in refresh `seq` predates their last save. */
    staleKeys: (seq: number): Set<string> => since(savedAtSeq, seq),
    /** Keys whose On/Off in refresh `seq` predates their last toggle. */
    staleFlagKeys: (seq: number): Set<string> => since(toggledAtSeq, seq),
  };
}

/** The Save PATCH body: the row's price only. On/Off is never sent here; only the toggle changes it (#490). */
export function pricingPatchBody(variant: AdminCostVariant): {
  display_name: string;
  credit_amount: number;
  provider_cost_usd: number;
} {
  return {
    display_name: variant.label,
    credit_amount: Math.round(variant.credits),
    provider_cost_usd: variant.providerReferenceUsd,
  };
}

/**
 * The On/Off PATCH body: the new flag with the last SAVED price, never the draft, so an unsaved price never
 * goes live with a toggle (#490). The saved price (not just the flag) is sent so a row with no database row
 * yet is created at the price the admin sees, not a code default.
 */
export function pricingToggleBody(
  variant: AdminCostVariant,
  enabled: boolean,
  saved: PricingBaseline
): ReturnType<typeof pricingPatchBody> & { enabled: boolean } {
  return { ...pricingPatchBody({ ...variant, ...saved }), enabled };
}

export function suggestCreditsFromProvider(
  providerReferenceUsd: number,
  settings: BillingSettings
): number {
  return suggestCredits(providerReferenceUsd, settings);
}

/** Photo-only: eligible feature keys for a tier (for save validation). */
export function isPhotoFeatureKey(key: string): key is PhotoFeatureKey {
  return PHOTO_FEATURES.some((f) => f.key === key);
}

/** Storyboard model ids exported for tests / UI hints. */
export { STORYBOARD_VIDEO_MODEL_IDS };
