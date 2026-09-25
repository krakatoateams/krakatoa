import { supabaseServer } from "@/lib/supabase-server";
import {
  acceptPendingCanvasInvites,
  getCanvasCollaboratorAccess,
  listSharedCanvasIds,
  type CanvasCollaboratorRole,
} from "@/lib/canvas-collaborators-db";
import {
  normalizeCanvasTitle,
  parseCanvasGraph,
  type CanvasAccessRole,
  type CanvasSummary,
  type SavedCanvasGraph,
} from "@/lib/canvas-document";
import type { Profile } from "@/lib/profiles-db";

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

export async function createCanvas(params: {
  profileId: string;
  title: string;
  graph: SavedCanvasGraph;
}): Promise<CanvasRecord> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .insert({
      profile_id: params.profileId,
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
}): Promise<CanvasRecord | null> {
  const access = await resolveCanvasAccess(params.profile, params.canvasId);
  if (!access?.canEdit) return null;

  const { data, error } = await supabaseServer
    .from(TABLE)
    .update({
      title: normalizeCanvasTitle(params.title),
      graph: params.graph,
    })
    .eq("id", params.canvasId)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to update canvas.");
  if (!data) return null;
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
