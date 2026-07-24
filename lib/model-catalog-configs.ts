import { PRODUCT_PHOTO_TIERS } from "@/lib/product-photo";
import { MOTION_CONTROL_MODELS } from "@/lib/motion-control-models";
import { VIDEO_MODELS } from "@/lib/video-models";

/**
 * Generation model catalog on/off (Admin Config v2 Phase 3).
 *
 * One row per (tool_key, model_id). Missing row = shipped default (enabled).
 * Align with: supabase/migrations/048_model_catalog_configs.sql,
 * lib/model-catalog-configs-db.ts, admin-config-tree.ts.
 */

export type ModelCatalogToolKey = "photo" | "reels";

export type ModelCatalogDefault = {
  toolKey: ModelCatalogToolKey;
  modelId: string;
  enabled: boolean;
  sortOrder: number;
};

/** All generation models in catalog order (photo tiers + video + motion control). */
export function defaultModelCatalogRows(): ModelCatalogDefault[] {
  const rows: ModelCatalogDefault[] = [];
  PRODUCT_PHOTO_TIERS.forEach((tier, i) => {
    rows.push({ toolKey: "photo", modelId: tier.id, enabled: true, sortOrder: i });
  });
  VIDEO_MODELS.forEach((model, i) => {
    rows.push({ toolKey: "reels", modelId: model.id, enabled: true, sortOrder: i });
  });
  MOTION_CONTROL_MODELS.forEach((model, i) => {
    rows.push({
      toolKey: "reels",
      modelId: model.id,
      enabled: true,
      sortOrder: VIDEO_MODELS.length + i,
    });
  });
  return rows;
}
