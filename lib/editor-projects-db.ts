import { supabaseServer } from "@/lib/supabase-server";
import {
  normalizeEditorTitle,
  parseEditorDocument,
  type EditorDocument,
  type EditorSummary,
} from "@/lib/editor-document";

const TABLE = "editor_projects";

export type EditorProjectRecord = {
  id: string;
  profileId: string;
  title: string;
  document: EditorDocument;
  createdAt: string;
  updatedAt: string;
};

export type { EditorSummary };

type EditorRow = {
  id: string;
  profile_id: string;
  title: string;
  document: unknown;
  created_at: string;
  updated_at: string;
};

function missingTableError(): Error {
  return new Error(
    "Database table editor_projects is missing. Apply supabase/migrations/086_editor_projects.sql."
  );
}

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (error.message.includes("editor_projects") && error.message.includes("schema cache")) {
    throw missingTableError();
  }
  throw new Error(error.message || fallback);
}

function toRecord(row: EditorRow): EditorProjectRecord | null {
  const document = parseEditorDocument(row.document);
  if (!document) return null;
  return {
    id: row.id,
    profileId: row.profile_id,
    title: row.title,
    document,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function clipCountOf(document: unknown): number {
  const parsed = parseEditorDocument(document);
  return parsed?.sequence.length ?? 0;
}

export async function listEditorProjects(
  profileId: string,
  limit = 50
): Promise<EditorSummary[]> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("id, title, document, created_at, updated_at")
    .eq("profile_id", profileId)
    .order("updated_at", { ascending: false })
    .limit(Math.min(100, Math.max(1, limit)));

  handleError(error, "Failed to list editor projects.");
  return ((data as EditorRow[] | null) ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    clipCount: clipCountOf(row.document),
  }));
}

export async function getEditorProject(
  profileId: string,
  projectId: string
): Promise<EditorProjectRecord | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("*")
    .eq("id", projectId)
    .eq("profile_id", profileId)
    .maybeSingle();

  handleError(error, "Failed to load editor project.");
  if (!data) return null;
  return toRecord(data as EditorRow);
}

export async function createEditorProject(params: {
  profileId: string;
  title: string;
  document: EditorDocument;
}): Promise<EditorProjectRecord> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .insert({
      profile_id: params.profileId,
      title: normalizeEditorTitle(params.title),
      document: params.document,
    })
    .select("*")
    .single();

  handleError(error, "Failed to save editor project.");
  const record = toRecord(data as EditorRow);
  if (!record) throw new Error("Saved editor project could not be read back.");
  return record;
}

export async function updateEditorProjectTitle(params: {
  profileId: string;
  projectId: string;
  title: string;
}): Promise<{ id: string; title: string; updatedAt: string } | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .update({ title: normalizeEditorTitle(params.title) })
    .eq("id", params.projectId)
    .eq("profile_id", params.profileId)
    .select("id, title, updated_at")
    .maybeSingle();

  handleError(error, "Failed to rename editor project.");
  if (!data) return null;
  const row = data as Pick<EditorRow, "id" | "title" | "updated_at">;
  return { id: row.id, title: row.title, updatedAt: row.updated_at };
}

export async function updateEditorProject(params: {
  profileId: string;
  projectId: string;
  title: string;
  document: EditorDocument;
}): Promise<EditorProjectRecord | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .update({
      title: normalizeEditorTitle(params.title),
      document: params.document,
    })
    .eq("id", params.projectId)
    .eq("profile_id", params.profileId)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to update editor project.");
  if (!data) return null;
  return toRecord(data as EditorRow);
}

export async function deleteEditorProject(
  profileId: string,
  projectId: string
): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .delete()
    .eq("id", projectId)
    .eq("profile_id", profileId)
    .select("id")
    .maybeSingle();

  handleError(error, "Failed to delete editor project.");
  return Boolean(data);
}
