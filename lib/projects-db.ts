import { supabaseServer } from "@/lib/supabase-server";

export type ProjectStatus = "active" | "archived" | "deleted";

export type Project = {
  id: string;
  profile_id: string;
  tool: string;
  title: string;
  status: ProjectStatus;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  deleted_at: string | null;
};

const PROJECTS_TABLE = "projects";

function missingTableError(): Error {
  return new Error(
    "Database table projects is missing. Run: npm run db:setup — or apply supabase/migrations/003_platform_foundation_nextauth_single_user.sql."
  );
}

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (error.message.includes("projects") && error.message.includes("schema cache")) {
    throw missingTableError();
  }
  throw new Error(error.message || fallback);
}

/** Create a project owned by the given profile. */
export async function createProject(params: {
  profileId: string;
  tool: string;
  title: string;
  metadata?: Record<string, unknown>;
}): Promise<Project> {
  const { data, error } = await supabaseServer
    .from(PROJECTS_TABLE)
    .insert({
      profile_id: params.profileId,
      tool: params.tool,
      title: params.title,
      metadata: params.metadata ?? {},
    })
    .select("*")
    .single();

  handleError(error, "Failed to create project.");
  return data as Project;
}

/** List a profile's projects (newest first), excluding soft-deleted by default. */
export async function listProjects(
  profileId: string,
  options?: {
    tool?: string;
    status?: ProjectStatus;
    includeDeleted?: boolean;
    limit?: number;
  }
): Promise<Project[]> {
  let query = supabaseServer
    .from(PROJECTS_TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 100);

  if (!options?.includeDeleted) {
    query = query.is("deleted_at", null);
  }
  if (options?.tool) {
    query = query.eq("tool", options.tool);
  }
  if (options?.status) {
    query = query.eq("status", options.status);
  }

  const { data, error } = await query;
  handleError(error, "Failed to list projects.");
  return (data as Project[] | null) ?? [];
}

/** Archive a project (ownership-checked). Returns the updated row or null. */
export async function archiveProject(
  profileId: string,
  projectId: string
): Promise<Project | null> {
  const { data, error } = await supabaseServer
    .from(PROJECTS_TABLE)
    .update({ status: "archived", archived_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("profile_id", profileId)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to archive project.");
  return (data as Project | null) ?? null;
}

/** Soft-delete a project (ownership-checked). Storage is not touched. */
export async function softDeleteProject(
  profileId: string,
  projectId: string
): Promise<Project | null> {
  const { data, error } = await supabaseServer
    .from(PROJECTS_TABLE)
    .update({ status: "deleted", deleted_at: new Date().toISOString() })
    .eq("id", projectId)
    .eq("profile_id", profileId)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to delete project.");
  return (data as Project | null) ?? null;
}
