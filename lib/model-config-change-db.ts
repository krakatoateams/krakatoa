import { casModelCatalogEnabled, ensureModelCatalogRows } from "@/lib/model-catalog-configs-db";
import { casFeatureModelConfig, ensureFeatureModelRows } from "@/lib/feature-model-configs-db";
import { listPricingConfigs } from "@/lib/pricing-configs-db";
import { listModelConfigs } from "@/lib/model-configs-db";
import { isProviderConfigured } from "@/lib/ai-provider-catalog";
import { modelEverOffered, recordModelConfigChange } from "@/lib/admin-config-audit-db";
import type { ModelChangeStore } from "@/lib/model-config-change";

/** Production store for lib/model-config-change.ts: service-role reads/CAS writes, best-effort audit. */
export const dbModelChangeStore: ModelChangeStore = {
  listCatalog: ensureModelCatalogRows,
  listFeatureRows: ensureFeatureModelRows,
  listPricing: () => listPricingConfigs(),
  listModelConfigs,
  providerConfigured: isProviderConfigured,
  casCatalog: casModelCatalogEnabled,
  casFeature: casFeatureModelConfig,
  everOffered: modelEverOffered,
  audit: ({ actorProfileId, action, toolKey, configKey, before, after }) =>
    recordModelConfigChange({ actorProfileId, action, toolKey, modelId: configKey, before, after }),
};
