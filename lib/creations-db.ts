import { supabaseServer } from "@/lib/supabase-server";
import {
  CREATION_TOOLS,
  CreationHistoryItem,
  CreationTool,
} from "@/lib/creations";
import { USER_CREATIONS_TABLE } from "@/lib/storage-buckets";

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

  return (data as UserCreationRow[] | null)?.map(rowToCreationItem) ?? [];
}
