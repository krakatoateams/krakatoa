import { supabaseServer } from "@/lib/supabase-server";

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type Job = {
  id: string;
  profile_id: string;
  project_id: string | null;
  tool: string;
  job_type: string;
  status: JobStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: Record<string, unknown> | null;
  cost_credits: number;
  provider: string | null;
  model: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

const JOBS_TABLE = "jobs";

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (error.message.includes("jobs") && error.message.includes("schema cache")) {
    throw new Error(
      "Database table jobs is missing. Run: npm run db:setup — or apply supabase/migrations/003_platform_foundation_nextauth_single_user.sql."
    );
  }
  throw new Error(error.message || fallback);
}

/** Create a job in 'queued' state at the start of a generation. */
export async function createJob(params: {
  profileId: string;
  tool: string;
  jobType: string;
  projectId?: string | null;
  input?: Record<string, unknown>;
  provider?: string;
  model?: string;
}): Promise<Job> {
  const { data, error } = await supabaseServer
    .from(JOBS_TABLE)
    .insert({
      profile_id: params.profileId,
      project_id: params.projectId ?? null,
      tool: params.tool,
      job_type: params.jobType,
      status: "queued",
      input: params.input ?? {},
      provider: params.provider ?? null,
      model: params.model ?? null,
    })
    .select("*")
    .single();

  handleError(error, "Failed to create job.");
  return data as Job;
}

/** Mark a job 'running' and stamp started_at (ownership-checked). */
export async function startJob(
  profileId: string,
  jobId: string
): Promise<Job | null> {
  const { data, error } = await supabaseServer
    .from(JOBS_TABLE)
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("profile_id", profileId)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to start job.");
  return (data as Job | null) ?? null;
}

/** Mark a job 'succeeded' with structured output (ownership-checked). */
export async function finishJob(
  profileId: string,
  jobId: string,
  params?: { output?: Record<string, unknown>; costCredits?: number }
): Promise<Job | null> {
  const patch: Record<string, unknown> = {
    status: "succeeded",
    finished_at: new Date().toISOString(),
  };
  if (params?.output !== undefined) patch.output = params.output;
  if (params?.costCredits !== undefined) patch.cost_credits = params.costCredits;

  const { data, error } = await supabaseServer
    .from(JOBS_TABLE)
    .update(patch)
    .eq("id", jobId)
    .eq("profile_id", profileId)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to finish job.");
  return (data as Job | null) ?? null;
}

/** Mark a job 'failed' with a structured error JSON (ownership-checked). */
export async function failJob(
  profileId: string,
  jobId: string,
  error: Record<string, unknown> | string
): Promise<Job | null> {
  const errorJson =
    typeof error === "string" ? { message: error } : error;

  const { data, error: dbError } = await supabaseServer
    .from(JOBS_TABLE)
    .update({
      status: "failed",
      error: errorJson,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId)
    .eq("profile_id", profileId)
    .select("*")
    .maybeSingle();

  handleError(dbError, "Failed to mark job failed.");
  return (data as Job | null) ?? null;
}

/** Mark a job 'cancelled' with a structured error/reason JSON (ownership-checked). */
export async function cancelJob(
  profileId: string,
  jobId: string,
  reason?: Record<string, unknown> | string
): Promise<Job | null> {
  const patch: Record<string, unknown> = {
    status: "cancelled",
    finished_at: new Date().toISOString(),
  };
  if (reason !== undefined) {
    patch.error = typeof reason === "string" ? { message: reason } : reason;
  }

  const { data, error: dbError } = await supabaseServer
    .from(JOBS_TABLE)
    .update(patch)
    .eq("id", jobId)
    .eq("profile_id", profileId)
    .select("*")
    .maybeSingle();

  handleError(dbError, "Failed to mark job cancelled.");
  return (data as Job | null) ?? null;
}

/** List a profile's jobs (newest first). */
export async function listJobs(
  profileId: string,
  options?: {
    tool?: string;
    status?: JobStatus;
    projectId?: string;
    limit?: number;
  }
): Promise<Job[]> {
  let query = supabaseServer
    .from(JOBS_TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 100);

  if (options?.tool) query = query.eq("tool", options.tool);
  if (options?.status) query = query.eq("status", options.status);
  if (options?.projectId) query = query.eq("project_id", options.projectId);

  const { data, error } = await query;
  handleError(error, "Failed to list jobs.");
  return (data as Job[] | null) ?? [];
}
