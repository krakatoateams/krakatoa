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

type CatalogSource = { id: string; offeredByDefault?: false };

/** Pure core of defaultModelCatalogRows(): `offeredByDefault: false` ships a model dark. */
export function catalogRowsFrom(
  photo: readonly CatalogSource[],
  video: readonly CatalogSource[],
  motion: readonly CatalogSource[]
): ModelCatalogDefault[] {
  const row = (toolKey: ModelCatalogToolKey, m: CatalogSource, sortOrder: number): ModelCatalogDefault => ({
    toolKey,
    modelId: m.id,
    enabled: m.offeredByDefault !== false,
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
