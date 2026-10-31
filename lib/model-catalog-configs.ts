import { PRODUCT_PHOTO_TIERS, type ProductPhotoModelTier } from "@/lib/product-photo";
import { MOTION_CONTROL_MODELS, type MotionControlModelId } from "@/lib/motion-control-models";
import { VIDEO_MODELS, type VideoModelId } from "@/lib/video-models";

/**
 * Generation model catalog on/off (Admin Config v2 Phase 3).
 *
 * One row per (tool_key, model_id). Missing row = shipped default (`catalogRowsFrom`).
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

type CatalogSource = { id: string; offeredByDefault?: boolean };

/**
 * Models offered before new models shipped dark by default (#453). They stay offered without a flag.
 * Every other registry entry must set `offeredByDefault` (test:model-catalog-guard fails otherwise), and
 * an entry without it is not offered. Frozen: never add to this list.
 */
export const OFFERED_BEFORE_SHIP_DARK: ReadonlySet<string> = new Set<ProductPhotoModelTier | VideoModelId | MotionControlModelId>([
  "basic", "balanced", "pro", "seedream4", "flux_kontext", "flux11", "imagen4", "ideogram3", "seedream3",
  "flux_schnell", "gpt_image_2", "seedance15_pro", "seedance1_pro_fast", "seedance1_lite", "seedance1_pro",
  "seedance2_mini", "seedance2_fast", "seedance2", "veo31_lite", "veo31_fast", "kling15_standard",
  "kling16_standard", "kling21", "kling25_turbo_pro", "kling26", "kling15_pro", "kling16_pro", "kling_v3",
  "kling_v3_omni", "grok_imagine_video", "kling26_motion", "kling_v3_motion",
]);

/** Pure core of defaultModelCatalogRows(): a model ships dark unless it says `offeredByDefault: true` or predates #453. */
export function catalogRowsFrom(
  photo: readonly CatalogSource[],
  video: readonly CatalogSource[],
  motion: readonly CatalogSource[]
): ModelCatalogDefault[] {
  const row = (toolKey: ModelCatalogToolKey, m: CatalogSource, sortOrder: number): ModelCatalogDefault => ({
    toolKey,
    modelId: m.id,
    enabled: m.offeredByDefault ?? OFFERED_BEFORE_SHIP_DARK.has(m.id),
    sortOrder,
  });
  return [
    ...photo.map((m, i) => row("photo", m, i)),
    ...video.map((m, i) => row("reels", m, i)),
    ...motion.map((m, i) => row("reels", m, video.length + i)),
  ];
}

/** All generation models in catalog order (photo tiers + video + motion control). */
export function defaultModelCatalogRows(): ModelCatalogDefault[] {
  return catalogRowsFrom(PRODUCT_PHOTO_TIERS, VIDEO_MODELS, MOTION_CONTROL_MODELS);
}

/** Offered model ids for a tool: a DB row wins, a missing row falls back to the code default. */
export function enabledIdsFromRows(
  toolKey: ModelCatalogToolKey,
  rows: readonly { tool_key: string; model_id: string; enabled: boolean }[],
  defaults: readonly ModelCatalogDefault[] = defaultModelCatalogRows()
): Set<string> {
  const byId = new Map(rows.filter((r) => r.tool_key === toolKey).map((r) => [r.model_id, r.enabled]));
  return new Set(
    defaults.filter((d) => d.toolKey === toolKey && (byId.get(d.modelId) ?? d.enabled)).map((d) => d.modelId)
  );
}

/** True when the error says the 118 columns do not exist (Postgres 42703 / PostgREST schema cache). */
export function isArchiveColumnMissing(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const msg = error.message ?? "";
  if (!msg.includes("archived_at") && !msg.includes("archived_by_profile_id")) return false;
  return error.code === "42703" || error.code === "PGRST204" || /does not exist|schema cache|Could not find/i.test(msg);
}
