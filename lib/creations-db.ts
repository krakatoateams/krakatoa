import { supabaseServer } from "@/lib/supabase-server";
import {
  CREATION_TOOLS,
  CreationHistoryItem,
  CreationTool,
} from "@/lib/creations";
import { STORAGE_BUCKET, USER_CREATIONS_TABLE } from "@/lib/storage-buckets";
import { resolveSignedMediaUrl } from "@/lib/storage-signed-url";

export type UserCreationRow = {
  id: string;
  created_at: string;
  user_id: string;
  tool: string;
  media_type: string;
  media_url: string;
  storage_path: string;
  title: string;
  metadata: Record<string, unknown> | null;
};

function tableMissingMessage(msg: string): boolean {
  return msg.includes("user_creations") && msg.includes("schema cache");
}

function missingTableError(): Error {
  return new Error(
    "Database table user_creations is missing. Run npm run db:setup (needs SUPABASE_ACCESS_TOKEN in .env.local), call GET /api/dev/setup-db with x-setup-key, connect Supabase MCP in Cursor (.cursor/mcp.json), or paste supabase/migrations/002_user_creations.sql in the Supabase SQL Editor."
  );
}

export function rowToCreationItem(row: UserCreationRow): CreationHistoryItem {
  const tool = row.tool as CreationTool;
  const meta = CREATION_TOOLS[tool];
  return {
    id: row.id,
    tool,
    toolLabel: meta?.label ?? row.tool,
    mediaType: row.media_type === "video" ? "video" : "image",
    mediaUrl: row.media_url,
    storagePath: row.storage_path,
    title: row.title,
    createdAt: row.created_at,
    metadata: row.metadata ?? {},
  };
}

export async function insertUserCreation(params: {
  userId: string;
  tool: CreationTool;
  mediaType: "image" | "video";
  mediaUrl: string;
  storagePath?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}): Promise<CreationHistoryItem> {
  const { data, error } = await supabaseServer
    .from(USER_CREATIONS_TABLE)
    .insert({
      user_id: params.userId,
      tool: params.tool,
      media_type: params.mediaType,
      media_url: params.mediaUrl,
      storage_path: params.storagePath ?? "",
      title: params.title ?? "",
      metadata: params.metadata ?? {},
    })
    .select("*")
    .single();

  if (error || !data) {
    const msg = error?.message || "Failed to save creation record";
    if (tableMissingMessage(msg)) throw missingTableError();
    throw new Error(msg);
  }

  return rowToCreationItem(data as UserCreationRow);
}

type AssetModelRow = {
  storage_path: string | null;
  model: string | null;
  metadata: Record<string, unknown> | null;
};

/**
 * Join platform `assets` rows (by storage_path) so library items expose the
 * canonical provider model from `assets.model` — the same field used at billing time.
 */
async function enrichCreationsFromAssets(
  userId: string,
  items: CreationHistoryItem[]
): Promise<CreationHistoryItem[]> {
  if (!items.length) return items;

  const { data: profile, error: profileErr } = await supabaseServer
    .from("profiles")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileErr || !profile?.id) return items;

  const paths = Array.from(
    new Set(items.map((i) => i.storagePath).filter((p) => p.length > 0))
  );
  if (!paths.length) return items;

  const { data: assetRows, error: assetErr } = await supabaseServer
    .from("assets")
    .select("storage_path, model, metadata")
    .eq("profile_id", profile.id)
    .in("storage_path", paths)
    .eq("status", "ready")
    .is("deleted_at", null);

  if (assetErr || !assetRows?.length) return items;

  const byPath = new Map<string, AssetModelRow>();
  for (const row of assetRows as AssetModelRow[]) {
    if (row.storage_path && !byPath.has(row.storage_path)) {
      byPath.set(row.storage_path, row);
    }
  }

  return items.map((item) => {
    const asset = item.storagePath ? byPath.get(item.storagePath) : undefined;
    if (!asset?.model?.trim()) return item;

    const assetMeta = asset.metadata ?? {};
    const patch: Record<string, unknown> = {
      providerModel: asset.model!.trim(),
    };
    if (
      typeof assetMeta.modelTier === "string" &&
      !item.metadata.modelTier
    ) {
      patch.modelTier = assetMeta.modelTier;
    }

    return {
      ...item,
      metadata: { ...item.metadata, ...patch },
    };
  });
}

/** Fetch a single creation owned by the user, or null if not found. Never throws. */
export async function getUserCreationForUser(
  userId: string,
  id: string
): Promise<CreationHistoryItem | null> {
  const { data, error } = await supabaseServer
    .from(USER_CREATIONS_TABLE)
    .select("*")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data) return null;
  return rowToCreationItem(data as UserCreationRow);
}

/**
 * Update an existing creation's title and/or merge a metadata patch. Scoped to the
 * owner (user_id) so a user can only edit their own creations. Reads the current
 * row first to merge metadata (jsonb), then writes back. Throws if not found.
 */
export async function updateUserCreation(params: {
  userId: string;
  id: string;
  title?: string;
  metadataPatch?: Record<string, unknown>;
}): Promise<CreationHistoryItem> {
  const { data: existing, error: selErr } = await supabaseServer
    .from(USER_CREATIONS_TABLE)
    .select("*")
    .eq("id", params.id)
    .eq("user_id", params.userId)
    .single();

  if (selErr || !existing) {
    const msg = selErr?.message || "Creation not found";
    if (tableMissingMessage(msg)) throw missingTableError();
    throw new Error(msg);
  }

  const current = existing as UserCreationRow;
  const update: Record<string, unknown> = {
    metadata: { ...(current.metadata ?? {}), ...(params.metadataPatch ?? {}) },
  };
  if (params.title !== undefined) update.title = params.title;

  const { data, error } = await supabaseServer
    .from(USER_CREATIONS_TABLE)
    .update(update)
    .eq("id", params.id)
    .eq("user_id", params.userId)
    .select("*")
    .single();

  if (error || !data) {
    const msg = error?.message || "Failed to update creation record";
    if (tableMissingMessage(msg)) throw missingTableError();
    throw new Error(msg);
  }

  return rowToCreationItem(data as UserCreationRow);
}

export async function listUserCreations(
  userId: string,
  options?: {
    tools?: CreationTool[];
    mediaType?: "image" | "video";
    limit?: number;
  }
): Promise<CreationHistoryItem[]> {
  const limit = options?.limit ?? 100;
  let query = supabaseServer
    .from(USER_CREATIONS_TABLE)
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options?.tools?.length) {
    query = query.in("tool", options.tools);
  }
  if (options?.mediaType) {
    query = query.eq("media_type", options.mediaType);
  }

  const { data, error } = await query;

  if (error) {
    if (tableMissingMessage(error.message)) throw missingTableError();
    throw new Error(error.message);
  }

  return enrichCreationsFromAssets(
    userId,
    (data as UserCreationRow[] | null)?.map(rowToCreationItem) ?? []
  );
}

export type CreationPageFilters = {
  tools?: CreationTool[];
  mediaType?: "image" | "video";
  /** Restrict to a creation kind stored in metadata (e.g. "character"). */
  kind?: string;
  /** Restrict to specific creation ids (used by the client-side Favorites view). */
  ids?: string[];
  /**
   * Trash filter (soft delete lives in metadata.deletedAt):
   *   - true  → only trashed items (the Trash view)
   *   - false / undefined → only non-trashed items (every normal view)
   */
  trashed?: boolean;
};

/**
 * Paginated listing for the library/history UI. Returns the requested window of
 * creations (newest first) plus the total row count for the same filters, so the
 * client can render real page controls without loading everything at once.
 */
export async function listUserCreationsPage(
  userId: string,
  options: CreationPageFilters & { offset: number; limit: number }
): Promise<{ items: CreationHistoryItem[]; total: number }> {
  const from = Math.max(0, options.offset);
  const to = from + Math.max(1, options.limit) - 1;

  let query = supabaseServer
    .from(USER_CREATIONS_TABLE)
    .select("*", { count: "exact" })
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (options.tools?.length) query = query.in("tool", options.tools);
  if (options.mediaType) query = query.eq("media_type", options.mediaType);
  if (options.kind) query = query.eq("metadata->>creationKind", options.kind);
  if (options.ids) query = query.in("id", options.ids);
  query = options.trashed
    ? query.not("metadata->>deletedAt", "is", null)
    : query.is("metadata->>deletedAt", null);

  const { data, error, count } = await query;

  if (error) {
    if (tableMissingMessage(error.message)) throw missingTableError();
    throw new Error(error.message);
  }

  const items = await enrichCreationsFromAssets(
    userId,
    (data as UserCreationRow[] | null)?.map(rowToCreationItem) ?? []
  );
  return { items, total: count ?? items.length };
}

/** Head-count helper for one filter set (no rows returned). */
async function countCreations(
  userId: string,
  filters: {
    tools?: CreationTool[];
    mediaType?: "image" | "video";
    kind?: string;
    trashed?: boolean;
  }
): Promise<number> {
  let query = supabaseServer
    .from(USER_CREATIONS_TABLE)
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);

  if (filters.tools?.length) query = query.in("tool", filters.tools);
  if (filters.mediaType) query = query.eq("media_type", filters.mediaType);
  if (filters.kind) query = query.eq("metadata->>creationKind", filters.kind);
  query = filters.trashed
    ? query.not("metadata->>deletedAt", "is", null)
    : query.is("metadata->>deletedAt", null);

  const { error, count } = await query;
  if (error) {
    if (tableMissingMessage(error.message)) throw missingTableError();
    throw new Error(error.message);
  }
  return count ?? 0;
}

/** Per-tab totals for the library pills (favorites are client-side, excluded). */
export async function countUserCreationsByTab(
  userId: string,
  options?: { tools?: CreationTool[] }
): Promise<{
  all: number;
  image: number;
  video: number;
  character: number;
  storyboard: number;
  trash: number;
}> {
  const tools = options?.tools;
  // Storyboards tab counts storyboard-tool creations, intersected with any outer
  // tool filter (empty intersection ⇒ 0, so it never falls back to counting all).
  const storyboardTools: CreationTool[] = tools?.length
    ? tools.filter((t) => t === "storyboard")
    : ["storyboard"];
  const [all, image, video, character, storyboard, trash] = await Promise.all([
    countCreations(userId, { tools }),
    countCreations(userId, { tools, mediaType: "image" }),
    countCreations(userId, { tools, mediaType: "video" }),
    countCreations(userId, { tools, kind: "character" }),
    storyboardTools.length
      ? countCreations(userId, { tools: storyboardTools })
      : Promise.resolve(0),
    countCreations(userId, { tools, trashed: true }),
  ]);
  return { all, image, video, character, storyboard, trash };
}

/** Move a creation to Trash (soft delete) by stamping metadata.deletedAt. */
export async function softDeleteUserCreation(
  userId: string,
  id: string
): Promise<CreationHistoryItem> {
  return updateUserCreation({
    userId,
    id,
    metadataPatch: { deletedAt: new Date().toISOString() },
  });
}

/** Restore a trashed creation by clearing metadata.deletedAt. */
export async function restoreUserCreation(
  userId: string,
  id: string
): Promise<CreationHistoryItem> {
  return updateUserCreation({ userId, id, metadataPatch: { deletedAt: null } });
}

/** Best-effort removal of storage objects by relative path; failures are logged, never thrown. */
export async function removeStorageObjects(paths: string[]): Promise<void> {
  const valid = paths.filter((p): p is string => !!p);
  if (!valid.length) return;
  const { error } = await supabaseServer.storage.from(STORAGE_BUCKET).remove(valid);
  if (error) {
    console.warn("[storage] cleanup failed:", error.message);
  }
}

/**
 * Permanently delete one creation: removes its storage object first (so the
 * product-photo reconcile can't resurrect it) then deletes the DB row.
 * Owner-scoped. Returns false if the row does not exist.
 */
export async function permanentlyDeleteUserCreation(
  userId: string,
  id: string
): Promise<boolean> {
  const { data, error: selErr } = await supabaseServer
    .from(USER_CREATIONS_TABLE)
    .select("storage_path")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (selErr) {
    if (tableMissingMessage(selErr.message)) throw missingTableError();
    throw new Error(selErr.message);
  }
  if (!data) return false;

  const storagePath = (data as { storage_path?: string }).storage_path;
  if (storagePath) await removeStorageObjects([storagePath]);

  const { error } = await supabaseServer
    .from(USER_CREATIONS_TABLE)
    .delete()
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    if (tableMissingMessage(error.message)) throw missingTableError();
    throw new Error(error.message);
  }
  return true;
}

/**
 * Permanently delete every trashed creation for a user (storage objects + rows).
 * Returns the number of rows removed.
 */
export async function emptyUserTrash(userId: string): Promise<number> {
  const { data, error } = await supabaseServer
    .from(USER_CREATIONS_TABLE)
    .select("id, storage_path")
    .eq("user_id", userId)
    .not("metadata->>deletedAt", "is", null);

  if (error) {
    if (tableMissingMessage(error.message)) throw missingTableError();
    throw new Error(error.message);
  }

  const rows = (data as { id: string; storage_path: string }[] | null) ?? [];
  if (!rows.length) return 0;

  await removeStorageObjects(rows.map((r) => r.storage_path));

  const { error: delErr } = await supabaseServer
    .from(USER_CREATIONS_TABLE)
    .delete()
    .eq("user_id", userId)
    .not("metadata->>deletedAt", "is", null);

  if (delErr) {
    if (tableMissingMessage(delErr.message)) throw missingTableError();
    throw new Error(delErr.message);
  }
  return rows.length;
}


/** Sign media URLs for API responses (private bucket ready). */
export async function signCreationItemsMedia(
  userId: string,
  items: CreationHistoryItem[],
): Promise<CreationHistoryItem[]> {
  return Promise.all(
    items.map(async (item) => {
      try {
        const signed = await resolveSignedMediaUrl({
          userId,
          storagePath: item.storagePath,
          mediaUrl: item.mediaUrl,
        });
        return signed ? { ...item, mediaUrl: signed } : item;
      } catch (err: unknown) {
        console.warn(
          "[creations] sign media failed:",
          item.storagePath || item.mediaUrl,
          err instanceof Error ? err.message : err,
        );
        return item;
      }
    }),
  );
}
