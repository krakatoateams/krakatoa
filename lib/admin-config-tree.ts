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
import { getModelDefault } from "@/lib/admin-config-defaults";
import { PIPELINE_GROUP_SPECS, type PipelineRoleSpec } from "@/lib/admin-pipeline-config";
import { getV2PricingDefault } from "@/lib/pricing-defaults";
import {
  VIDEO_COMPOSER_FEATURES,
  defaultVideoComposerRows,
  modelEligibleForComposer,
} from "@/lib/video-composer-features";
import {
  STORYBOARD_VIDEO_MODEL_IDS,
  VIDEO_MODELS,
  type VideoModel,
  type VideoPricingContext,
  type VideoResolution,
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

export type AdminModelNode = {
  id: string;
  label: string;
  subtitle: string;
  enabled: boolean;
  features: AdminFeatureToggle[];
  variants: AdminCostVariant[];
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
  const resolutions: VideoResolution[] =
    model.resolutions.length > 0 ? model.resolutions : [model.defaultResolution];
  const audioFlags = model.supportsAudio ? [false, true] : [false];
  const refFlags = model.references.referenceVideos > 0 ? [false, true] : [false];

  for (const resolution of resolutions) {
    for (const generateAudio of audioFlags) {
      for (const hasReferenceVideo of refFlags) {
        const ctx: VideoPricingContext = { resolution, generateAudio, hasReferenceVideo };
        const key = model.pricingKey(ctx);
        if (!seen.has(key)) {
          seen.set(key, humanVideoVariantLabel(model, ctx));
        }
      }
    }
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
      eligible: true,
    };
  });
}

/**
 * One default model per mode (feature key) across the whole tool. Each model used to
 * mark its primary mode as default independently — this normalizes after the tree is built.
 */
function normalizeDefaultsPerMode(models: AdminModelNode[]): AdminModelNode[] {
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

  return models.map((m) => ({
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
  if (tier.basicPricingKey) {
    const v = variantFromPricingRow(
      tier.basicPricingKey,
      "Per image (no resolution tiers)",
      map,
      settings
    );
    return v ? [v] : [];
  }
  return tier.resolutions
    .map((r) => variantFromPricingRow(r.pricingKey, r.label, map, settings))
    .filter((v): v is AdminCostVariant => v !== null);
}

function buildVideoModels(
  map: Map<string, PricingConfigInput>,
  settings: BillingSettings,
  featureModels: FeatureModelInput[]
): AdminModelNode[] {
  const models: AdminModelNode[] = [];

  for (const model of VIDEO_MODELS) {
    const variants = enumerateVideoVariants(model, map, settings);
    if (variants.length === 0) continue;
    models.push({
      id: model.id,
      label: model.modelLabel,
      subtitle: model.providerModel,
      enabled: true,
      features: buildVideoFeatures(model.id, featureModels),
      variants,
    });
  }

  for (const model of MOTION_CONTROL_MODELS) {
    const variants = enumerateMotionVariants(model, map, settings);
    if (variants.length === 0) continue;
    models.push({
      id: model.id,
      label: model.modelLabel,
      subtitle: model.providerModel,
      enabled: true,
      features: buildVideoFeatures(model.id, featureModels),
      variants,
    });
  }

  return normalizeDefaultsPerMode(models);
}

function buildPhotoModels(
  map: Map<string, PricingConfigInput>,
  settings: BillingSettings,
  featureModels: FeatureModelInput[]
): AdminModelNode[] {
  return normalizeDefaultsPerMode(
    PRODUCT_PHOTO_TIERS.map((tier) => ({
      id: tier.id,
      label: tier.modelLabel,
      subtitle: tier.providerModel,
      enabled: true,
      features: buildPhotoFeatures(tier.id, featureModels),
      variants: enumeratePhotoVariants(tier, map, settings),
    })).filter((m) => m.variants.length > 0)
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
    featureModels: FeatureModelInput[]
  ) => AdminModelNode[]
> = {
  reels: (map, settings, featureModels) => buildVideoModels(map, settings, featureModels),
  photo: (map, settings, featureModels) => buildPhotoModels(map, settings, featureModels),
};

/** Tools shown in config v2 (dashboard omitted — toggle-only elsewhere if needed). */
const CONFIG_TOOL_ORDER = ["reels", "photo", "ig", "schedule", "calendar"];

export function buildAdminConfigTree(params: {
  tools: ToolConfigInput[];
  pricing: PricingConfigInput[];
  featureModels: FeatureModelInput[];
  modelConfigs: ModelConfigInput[];
  billingSettings: BillingSettings;
}): AdminToolNode[] {
  const toolByKey = new Map(params.tools.map((t) => [t.tool_key, t]));
  const pmap = pricingMap(params.pricing);

  return CONFIG_TOOL_ORDER.flatMap((toolKey) => {
    const tool = toolByKey.get(toolKey);
    if (!tool) return [];

    const buildModels = MODEL_BUILDERS[toolKey];
    const models = buildModels
      ? buildModels(pmap, params.billingSettings, params.featureModels)
      : [];

    const pipelines =
      toolKey === "reels" || toolKey === "photo"
        ? buildPipelineGroupsForTool(toolKey, params.modelConfigs, pmap, params.billingSettings)
        : [];

    return [
      {
        toolKey: tool.tool_key,
        label: tool.display_name,
        enabled: tool.enabled,
        visibleInSidebar: tool.visible_in_sidebar,
        sortOrder: tool.sort_order,
        models,
        pipelines,
      },
    ];
  });
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
