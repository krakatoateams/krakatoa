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
 * deprecates its prices, and it must still show under "Add model" (blocked until priced again).
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
 * The tool card's model list and its "Add model" picker, from the same catalog rows: a removed
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
