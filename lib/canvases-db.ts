import { supabaseServer } from "@/lib/supabase-server";
import {
  normalizeCanvasTitle,
  parseCanvasGraph,
  type CanvasSummary,
  type SavedCanvasGraph,
} from "@/lib/canvas-document";

const TABLE = "canvases";

export type CanvasRecord = {
  id: string;
  profileId: string;
  title: string;
  graph: SavedCanvasGraph;
  createdAt: string;
  updatedAt: string;
};

export type { CanvasSummary };

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

export async function listCanvases(
  profileId: string,
  limit = 50
): Promise<CanvasSummary[]> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("id, title, graph, created_at, updated_at")
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, limit)));

  handleError(error, "Failed to list canvases.");
  return ((data as CanvasRow[] | null) ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nodeCount: nodeCountOf(row.graph),
  }));
}

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
