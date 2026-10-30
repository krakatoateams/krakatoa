import { supabaseServer } from "@/lib/supabase-server";
import {
  defaultModelCatalogRows,
  enabledIdsFromRows,
  isArchiveColumnMissing,
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
  /** Present only after migration 118; absent/null = not archived. */
  archived_at?: string | null;
  archived_by_profile_id?: string | null;
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

/** Compare-and-set: applies only while updated_at still equals what the admin saw; null = no row matched. */
export async function casModelCatalogEnabled(
  id: string,
  enabled: boolean,
  expectedUpdatedAt: string,
  updatedByProfileId: string | null
): Promise<ModelCatalogConfig | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .update({ enabled, updated_by_profile_id: updatedByProfileId })
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
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
    const enabled = enabledIdsFromRows(toolKey, rows);

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

// ---------------------------------------------------------------------------
// Archive (migration 118). Everything here tolerates the columns being absent.
// ---------------------------------------------------------------------------

export class ArchiveMigrationRequiredError extends Error {
  constructor() {
    super("Run migration 118 to enable archiving");
    this.name = "ArchiveMigrationRequiredError";
  }
}

const ARCHIVE_PROBE_TTL_MS = 5_000;
let archiveProbe: { available: boolean; expiresAt: number } | null = null;

/**
 * Column-existence probe, cached for a few seconds so applying the migration takes effect without a
 * redeploy. Never throws: any failure reads as "not available" (the inert, safe state).
 */
export async function archiveColumnAvailable(): Promise<boolean> {
  const now = Date.now();
  if (archiveProbe && now < archiveProbe.expiresAt) return archiveProbe.available;
  let available = false;
  try {
    const { error } = await supabaseServer.from(TABLE).select("archived_at").limit(1);
    available = !error;
  } catch {
    available = false;
  }
  archiveProbe = { available, expiresAt: now + ARCHIVE_PROBE_TTL_MS };
  return available;
}

/** Compare-and-set archive/restore. Archive also turns the model off (the DB check requires it). */
export async function casModelCatalogArchive(
  id: string,
  archive: boolean,
  expectedUpdatedAt: string,
  updatedByProfileId: string | null
): Promise<ModelCatalogConfig | null> {
  const update: Record<string, unknown> = archive
    ? {
        enabled: false,
        archived_at: new Date().toISOString(),
        archived_by_profile_id: updatedByProfileId,
        updated_by_profile_id: updatedByProfileId,
      }
    : { archived_at: null, archived_by_profile_id: null, updated_by_profile_id: updatedByProfileId };
  const { data, error } = await supabaseServer
    .from(TABLE)
    .update(update)
    .eq("id", id)
    .eq("updated_at", expectedUpdatedAt)
    .select("*")
    .maybeSingle();
  if (isArchiveColumnMissing(error)) {
    archiveProbe = { available: false, expiresAt: Date.now() + ARCHIVE_PROBE_TTL_MS };
    throw new ArchiveMigrationRequiredError();
  }
  handleError(error, "Failed to archive model catalog config.");
  cache = { byTool: null, expiresAt: 0 };
  return (data as ModelCatalogConfig | null) ?? null;
}
