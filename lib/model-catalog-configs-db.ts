import { supabaseServer } from "@/lib/supabase-server";
import {
  defaultModelCatalogRows,
  type ModelCatalogToolKey,
} from "@/lib/model-catalog-configs";

/**
 * Generation model catalog enablement (service-role).
 * Missing row = enabled (shipped default).
 */

export type ModelCatalogConfig = {
  id: string;
  tool_key: string;
  model_id: string;
  enabled: boolean;
  sort_order: number;
  metadata: Record<string, unknown>;
  updated_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

const TABLE = "model_catalog_configs";

const CACHE_TTL_MS = 0;
type CatalogCache = {
  byTool: Partial<Record<ModelCatalogToolKey, Set<string>>> | null;
  expiresAt: number;
};
let cache: CatalogCache = { byTool: null, expiresAt: 0 };

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (
    error.message.includes(TABLE) &&
    (error.message.includes("schema cache") || error.message.includes("does not exist"))
  ) {
    throw new Error(
      `Database table ${TABLE} is missing. Apply supabase/migrations/048_model_catalog_configs.sql.`
    );
  }
  throw new Error(error.message || fallback);
}

export async function listModelCatalogConfigs(): Promise<ModelCatalogConfig[]> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("*")
    .order("tool_key", { ascending: true })
    .order("sort_order", { ascending: true });

  handleError(error, "Failed to list model catalog configs.");
  return (data as ModelCatalogConfig[] | null) ?? [];
}

export async function getModelCatalogConfigById(
  id: string
): Promise<ModelCatalogConfig | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  handleError(error, "Failed to fetch model catalog config.");
  return (data as ModelCatalogConfig | null) ?? null;
}

/** Materialize missing catalog rows from code (insert-only). */
export async function ensureModelCatalogRows(): Promise<ModelCatalogConfig[]> {
  const existing = await listModelCatalogConfigs();
  const seen = new Set(existing.map((r) => `${r.tool_key}:${r.model_id}`));

  const missing = defaultModelCatalogRows()
    .filter((d) => !seen.has(`${d.toolKey}:${d.modelId}`))
    .map((d) => ({
      tool_key: d.toolKey,
      model_id: d.modelId,
      enabled: d.enabled,
      sort_order: d.sortOrder,
    }));

  if (missing.length === 0) return existing;

  const { error } = await supabaseServer.from(TABLE).insert(missing);
  if (error && !error.message.includes("duplicate")) {
    handleError(error, "Failed to materialize model catalog configs.");
  }
  return listModelCatalogConfigs();
}

export async function updateModelCatalogConfig(
  id: string,
  patch: { enabled?: boolean },
  updatedByProfileId: string | null
): Promise<ModelCatalogConfig | null> {
  const row = await getModelCatalogConfigById(id);
  if (!row) return null;

  const update: Record<string, unknown> = { updated_by_profile_id: updatedByProfileId };
  if (patch.enabled !== undefined) update.enabled = patch.enabled;

  const { data, error } = await supabaseServer
    .from(TABLE)
    .update(update)
    .eq("id", id)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to update model catalog config.");
  cache = { byTool: null, expiresAt: 0 };
  return (data as ModelCatalogConfig | null) ?? null;
}

function codeDefaultEnabledIds(toolKey: ModelCatalogToolKey): Set<string> {
  return new Set(
    defaultModelCatalogRows()
      .filter((r) => r.toolKey === toolKey && r.enabled)
      .map((r) => r.modelId)
  );
}

/** Enabled model ids for a tool; missing DB row counts as enabled. */
export async function getEnabledCatalogModelIds(
  toolKey: ModelCatalogToolKey
): Promise<Set<string>> {
  const now = Date.now();
  if (cache.byTool?.[toolKey] && now < cache.expiresAt) {
    return cache.byTool[toolKey]!;
  }

  try {
    const rows = await listModelCatalogConfigs();
    const toolRows = rows.filter((r) => r.tool_key === toolKey);
    const defaults = defaultModelCatalogRows().filter((r) => r.toolKey === toolKey);
    const byId = new Map(toolRows.map((r) => [r.model_id, r.enabled]));

    const enabled = new Set<string>();
    for (const def of defaults) {
      const dbEnabled = byId.get(def.modelId);
      if (dbEnabled === undefined ? def.enabled : dbEnabled) {
        enabled.add(def.modelId);
      }
    }

    cache.byTool = { ...cache.byTool, [toolKey]: enabled };
    cache.expiresAt = now + CACHE_TTL_MS;
    return enabled;
  } catch (e) {
    console.warn("[model-catalog-configs] DB read failed, using code defaults:", e);
    return codeDefaultEnabledIds(toolKey);
  }
}

export async function isCatalogModelEnabled(
  toolKey: ModelCatalogToolKey,
  modelId: string
): Promise<boolean> {
  const enabled = await getEnabledCatalogModelIds(toolKey);
  return enabled.has(modelId);
}
