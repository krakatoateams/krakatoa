import { supabaseServer } from "@/lib/supabase-server";
import {
  acceptPendingCanvasInvites,
  getCanvasCollaboratorAccess,
  listSharedCanvasIds,
  type CanvasCollaboratorRole,
} from "@/lib/canvas-collaborators-db";
import {
  addedCanvasStoragePaths,
  canvasStoragePaths,
  normalizeCanvasTitle,
  parseCanvasGraph,
  type CanvasAccessRole,
  type CanvasSummary,
  type SavedCanvasGraph,
} from "@/lib/canvas-document";
import type { Profile } from "@/lib/profiles-db";
import { isStorageRelativePath, storagePathOwnerUserId } from "@/lib/storage-buckets";
import {
  assertPathOwnedByUser,
  createSignedStorageUrl,
  signStoragePathForUser,
  type SignTtlKind,
} from "@/lib/storage-signed-url";

const TABLE = "canvases";

export type CanvasRecord = {
  id: string;
  profileId: string;
  title: string;
  graph: SavedCanvasGraph;
  createdAt: string;
  updatedAt: string;
};

export type { CanvasAccessRole, CanvasSummary };

export type CanvasAccess = {
  role: CanvasAccessRole;
  ownerProfileId: string;
  canEdit: boolean;
};

type CanvasRow = {
  id: string;
  profile_id: string;
  title: string;
  graph: unknown;
  created_at: string;
  updated_at: string;
};

function missingTableError(): Error {
  return new Error(
    "Database table canvases is missing. Apply supabase/migrations/081_canvases.sql."
  );
}

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (error.message.includes("canvases") && error.message.includes("schema cache")) {
    throw missingTableError();
  }
  throw new Error(error.message || fallback);
}

function toRecord(row: CanvasRow): CanvasRecord | null {
  const graph = parseCanvasGraph(row.graph);
  if (!graph) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    graph,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function nodeCountOf(graph: unknown): number {
  const parsed = parseCanvasGraph(graph);
  return parsed?.nodes.length ?? 0;
}

function collaboratorCanEdit(role: CanvasCollaboratorRole): boolean {
  return role === "editor";
}

export async function resolveCanvasAccess(
  profile: Profile,
  canvasId: string
): Promise<CanvasAccess | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("id, profile_id")
    .eq("id", canvasId)
    .maybeSingle();

  handleError(error, "Failed to resolve canvas access.");
  if (!data) return null;

  const ownerProfileId = (data as Pick<CanvasRow, "profile_id">).profile_id;
  if (ownerProfileId === profile.id) {
    return { role: "owner", ownerProfileId, canEdit: true };
  }

  const collaborator = await getCanvasCollaboratorAccess(profile, canvasId);
  if (!collaborator) return null;

  return {
    role: collaborator.role,
    ownerProfileId,
    canEdit: collaboratorCanEdit(collaborator.role),
  };
}

export async function listCanvases(profile: Profile, limit = 50): Promise<CanvasSummary[]> {
  await acceptPendingCanvasInvites(profile);
  const cap = Math.min(100, Math.max(1, limit));

  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("id, title, graph, created_at, updated_at")
    .eq("profile_id", profile.id)
    .order("updated_at", { ascending: false })
    .limit(cap);

  handleError(error, "Failed to list canvases.");
  const owned = ((data as CanvasRow[] | null) ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nodeCount: nodeCountOf(row.graph),
    role: "owner" as const,
  }));

  const sharedLinks = await listSharedCanvasIds(profile);
  if (sharedLinks.length === 0) return owned;

  const ownedIds = new Set(owned.map((item) => item.id));
  const sharedIds = sharedLinks
    .map((item) => item.canvasId)
    .filter((id) => !ownedIds.has(id));
  if (sharedIds.length === 0) return owned;

  const { data: sharedRows, error: sharedError } = await supabaseServer
    .from(TABLE)
    .select("id, title, graph, created_at, updated_at")
    .in("id", sharedIds)
    .order("updated_at", { ascending: false })
    .limit(cap);

  handleError(sharedError, "Failed to list shared canvases.");
  const roleByCanvasId = new Map(sharedLinks.map((item) => [item.canvasId, item.role]));
  const shared = ((sharedRows as CanvasRow[] | null) ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nodeCount: nodeCountOf(row.graph),
    shared: true,
    role: roleByCanvasId.get(row.id) ?? "viewer",
  }));

  return [...owned, ...shared]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, cap);
}

export async function getCanvasForProfile(
  profile: Profile,
  canvasId: string
): Promise<{ record: CanvasRecord; access: CanvasAccess } | null> {
  const access = await resolveCanvasAccess(profile, canvasId);
  if (!access) return null;

  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("*")
    .eq("id", canvasId)
    .maybeSingle();

  handleError(error, "Failed to load canvas.");
  if (!data) return null;
  const record = toRecord(data as CanvasRow);
  if (!record) return null;
  return { record, access };
}

/** @deprecated Use getCanvasForProfile — kept for owner-only internal callers if any remain. */
export async function getCanvas(
  profileId: string,
  canvasId: string
): Promise<CanvasRecord | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("*")
    .eq("id", canvasId)
    .eq("profile_id", profileId)
    .maybeSingle();

  handleError(error, "Failed to load canvas.");
  if (!data) return null;
  return toRecord(data as CanvasRow);
}

/** Display names for the people who own files already on this canvas. */
export async function canvasFileCreators(
  graph: SavedCanvasGraph
): Promise<Record<string, string>> {
  const ids = [
    ...new Set(
      canvasStoragePaths(graph)
        .map((path) => storagePathOwnerUserId(path))
        .filter((id): id is string => Boolean(id))
    ),
  ];
  if (!ids.length) return {};
  const { data, error } = await supabaseServer
    .from("profiles")
    .select("user_id, email, display_name")
    .in("user_id", ids);
  if (error || !data) return {};
  const creators: Record<string, string> = {};
  for (const row of data as Array<{
    user_id: string;
    email: string | null;
    display_name: string | null;
  }>) {
    const label = row.display_name?.trim() || row.email?.trim();
    if (label) creators[row.user_id] = label;
  }
  return creators;
}

export function canvasSaveErrorStatus(error: unknown): number | null {
  const code =
    error && typeof error === "object" && "code" in error
      ? (error as { code?: string }).code
      : "";
  if (code === "CANVAS_CONFLICT") return 409;
  if (code === "CANVAS_PATH") return 400;
  return null;
}

async function assertAddedCanvasPaths(
  profile: Profile,
  previous: SavedCanvasGraph | null,
  next: SavedCanvasGraph
): Promise<void> {
  for (const path of addedCanvasStoragePaths(previous, next)) {
    try {
      await assertPathOwnedByUser(path, profile.user_id);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (/forbidden|invalid storage/i.test(message)) {
        throw Object.assign(
          new Error("You can only place files from your own library on this canvas."),
          { code: "CANVAS_PATH" }
        );
      }
      throw err;
    }
  }
}

/**
 * A canvas reader may sign a file when the path is on a canvas they can open
 * and the file belongs to the owner or an accepted collaborator.
 * ponytail: one containment query, not a shared media bucket.
 */
export async function readerCanOpenCanvasPath(
  userId: string,
  storagePath: string
): Promise<boolean> {
  const fileOwnerUserId = storagePathOwnerUserId(storagePath);
  if (!fileOwnerUserId || !isStorageRelativePath(storagePath)) return false;

  const { data: reader, error: readerError } = await supabaseServer
    .from("profiles")
    .select("id, email")
    .eq("user_id", userId)
    .maybeSingle();
  if (readerError || !reader?.id) return false;

  const { data: canvases, error: canvasError } = await supabaseServer
    .from(TABLE)
    .select("id, profile_id")
    .contains("graph", { nodes: [{ data: { resultStoragePath: storagePath } }] })
    .limit(50);
  if (canvasError || !canvases?.length) return false;

  const canvasIds = canvases.map((row) => (row as { id: string }).id);
  const { data: collabs, error: collabError } = await supabaseServer
    .from("canvas_collaborators")
    .select("canvas_id, invitee_profile_id, invited_email")
    .in("canvas_id", canvasIds)
    .eq("status", "accepted");
  if (collabError) return false;

  const profileIds = new Set<string>();
  for (const canvas of canvases) profileIds.add((canvas as { profile_id: string }).profile_id);
  for (const collab of collabs ?? []) {
    const inviteeId = (collab as { invitee_profile_id: string | null }).invitee_profile_id;
    if (inviteeId) profileIds.add(inviteeId);
  }

  const { data: profiles, error: profileError } = await supabaseServer
    .from("profiles")
    .select("id, user_id")
    .in("id", [...profileIds]);
  if (profileError || !profiles?.length) return false;
  const userIdByProfile = new Map(
    (profiles as Array<{ id: string; user_id: string }>).map((row) => [row.id, row.user_id])
  );
  const readerEmail =
    typeof (reader as { email?: string | null }).email === "string"
      ? (reader as { email: string }).email.trim().toLowerCase()
      : "";

  for (const canvas of canvases as Array<{ id: string; profile_id: string }>) {
    const members = (collabs ?? []).filter(
      (row) => (row as { canvas_id: string }).canvas_id === canvas.id
    ) as Array<{ invitee_profile_id: string | null; invited_email: string }>;
    const readerIsOwner = canvas.profile_id === (reader as { id: string }).id;
    const readerIsCollab = members.some(
      (row) =>
        row.invitee_profile_id === (reader as { id: string }).id ||
        (readerEmail !== "" && row.invited_email === readerEmail)
    );
    if (!readerIsOwner && !readerIsCollab) continue;

    const memberUserIds = new Set<string>();
    const ownerUserId = userIdByProfile.get(canvas.profile_id);
    if (ownerUserId) memberUserIds.add(ownerUserId);
    for (const member of members) {
      const memberUserId = member.invitee_profile_id
        ? userIdByProfile.get(member.invitee_profile_id)
        : undefined;
      if (memberUserId) memberUserIds.add(memberUserId);
    }
    if (memberUserIds.has(fileOwnerUserId)) return true;
  }
  return false;
}

export async function signStoragePathIfReadable(
  storagePath: string,
  userId: string,
  ttl: SignTtlKind | number = "ui"
) {
  try {
    return await signStoragePathForUser(storagePath, userId, ttl);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/forbidden/i.test(message)) throw err;
    if (!(await readerCanOpenCanvasPath(userId, storagePath))) throw err;
    return createSignedStorageUrl(storagePath, ttl);
  }
}

export async function createCanvas(params: {
  profile: Profile;
  title: string;
  graph: SavedCanvasGraph;
}): Promise<CanvasRecord> {
  await assertAddedCanvasPaths(params.profile, null, params.graph);
  const { data, error } = await supabaseServer
    .from(TABLE)
    .insert({
      profile_id: params.profile.id,
      title: normalizeCanvasTitle(params.title),
      graph: params.graph,
    })
    .select("*")
    .single();

  handleError(error, "Failed to save canvas.");
  const record = toRecord(data as CanvasRow);
  if (!record) throw new Error("Saved canvas could not be read back.");
  return record;
}

export async function updateCanvasTitleForProfile(params: {
  profile: Profile;
  canvasId: string;
  title: string;
}): Promise<{ id: string; title: string; updatedAt: string } | null> {
  const access = await resolveCanvasAccess(params.profile, params.canvasId);
  if (!access?.canEdit) return null;

  const { data, error } = await supabaseServer
    .from(TABLE)
    .update({ title: normalizeCanvasTitle(params.title) })
    .eq("id", params.canvasId)
    .select("id, title, updated_at")
    .maybeSingle();

  handleError(error, "Failed to rename canvas.");
  if (!data) return null;
  const row = data as Pick<CanvasRow, "id" | "title" | "updated_at">;
  return { id: row.id, title: row.title, updatedAt: row.updated_at };
}

export async function updateCanvasTitle(params: {
  profileId: string;
  canvasId: string;
  title: string;
}): Promise<{ id: string; title: string; updatedAt: string } | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .update({ title: normalizeCanvasTitle(params.title) })
    .eq("id", params.canvasId)
    .eq("profile_id", params.profileId)
    .select("id, title, updated_at")
    .maybeSingle();

  handleError(error, "Failed to rename canvas.");
  if (!data) return null;
  const row = data as Pick<CanvasRow, "id" | "title" | "updated_at">;
  return { id: row.id, title: row.title, updatedAt: row.updated_at };
}

export async function updateCanvasForProfile(params: {
  profile: Profile;
  canvasId: string;
  title: string;
  graph: SavedCanvasGraph;
  baseUpdatedAt?: string | null;
}): Promise<CanvasRecord | null> {
  const access = await resolveCanvasAccess(params.profile, params.canvasId);
  if (!access?.canEdit) return null;

  const { data: current, error: readError } = await supabaseServer
    .from(TABLE)
    .select("*")
    .eq("id", params.canvasId)
    .maybeSingle();
  handleError(readError, "Failed to update canvas.");
  if (!current) return null;
  const existing = toRecord(current as CanvasRow);
  if (!existing) return null;
  if (params.baseUpdatedAt && params.baseUpdatedAt !== existing.updatedAt) {
    throw Object.assign(
      new Error("Someone else saved this canvas. Reload to see their version."),
      { code: "CANVAS_CONFLICT" }
    );
  }
  await assertAddedCanvasPaths(params.profile, existing.graph, params.graph);

  let update = supabaseServer
    .from(TABLE)
    .update({
      title: normalizeCanvasTitle(params.title),
      graph: params.graph,
    })
    .eq("id", params.canvasId);
  if (params.baseUpdatedAt) update = update.eq("updated_at", params.baseUpdatedAt);
  const { data, error } = await update.select("*").maybeSingle();

  handleError(error, "Failed to update canvas.");
  if (!data) {
    if (params.baseUpdatedAt) {
      throw Object.assign(
        new Error("Someone else saved this canvas. Reload to see their version."),
        { code: "CANVAS_CONFLICT" }
      );
    }
    return null;
  }
  return toRecord(data as CanvasRow);
}

export async function updateCanvas(params: {
  profileId: string;
  canvasId: string;
  title: string;
  graph: SavedCanvasGraph;
}): Promise<CanvasRecord | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .update({
      title: normalizeCanvasTitle(params.title),
      graph: params.graph,
    })
    .eq("id", params.canvasId)
    .eq("profile_id", params.profileId)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to update canvas.");
  if (!data) return null;
  return toRecord(data as CanvasRow);
}

export async function deleteCanvas(
  profileId: string,
  canvasId: string
): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .delete()
    .eq("id", canvasId)
    .eq("profile_id", profileId)
    .select("id")
    .maybeSingle();

  handleError(error, "Failed to delete canvas.");
  return Boolean(data);
}
