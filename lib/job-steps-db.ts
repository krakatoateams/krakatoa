import { supabaseServer } from "@/lib/supabase-server";

export type JobStepStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export type JobStep = {
  id: string;
  job_id: string;
  profile_id: string;
  step_key: string;
  step_name: string | null;
  status: JobStepStatus;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  error: Record<string, unknown> | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

const JOB_STEPS_TABLE = "job_steps";

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (error.message.includes("job_steps") && error.message.includes("schema cache")) {
    throw new Error(
      "Database table job_steps is missing. Run: npm run db:setup — or apply supabase/migrations/003_platform_foundation_nextauth_single_user.sql."
    );
  }
  throw new Error(error.message || fallback);
}

/** Create a pipeline step (defaults to 'pending'). */
export async function createJobStep(params: {
  jobId: string;
  profileId: string;
  stepKey: string;
  stepName?: string;
  status?: JobStepStatus;
  input?: Record<string, unknown>;
}): Promise<JobStep> {
  const { data, error } = await supabaseServer
    .from(JOB_STEPS_TABLE)
    .insert({
      job_id: params.jobId,
      profile_id: params.profileId,
      step_key: params.stepKey,
      step_name: params.stepName ?? null,
      status: params.status ?? "pending",
      input: params.input ?? {},
    })
    .select("*")
    .single();

  handleError(error, "Failed to create job step.");
  return data as JobStep;
}

/** Mark a step 'running' and stamp started_at (ownership-checked). */
export async function startJobStep(
  profileId: string,
  stepId: string,
  input?: Record<string, unknown>
): Promise<JobStep | null> {
  const patch: Record<string, unknown> = {
    status: "running",
    started_at: new Date().toISOString(),
  };
  if (input !== undefined) patch.input = input;

  const { data, error } = await supabaseServer
    .from(JOB_STEPS_TABLE)
    .update(patch)
    .eq("id", stepId)
    .eq("profile_id", profileId)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to start job step.");
  return (data as JobStep | null) ?? null;
}

/** Mark a step 'succeeded' with structured output (ownership-checked). */
export async function finishJobStep(
  profileId: string,
  stepId: string,
  output?: Record<string, unknown>
): Promise<JobStep | null> {
  const patch: Record<string, unknown> = {
    status: "succeeded",
    finished_at: new Date().toISOString(),
  };
  if (output !== undefined) patch.output = output;

  const { data, error } = await supabaseServer
    .from(JOB_STEPS_TABLE)
    .update(patch)
    .eq("id", stepId)
    .eq("profile_id", profileId)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to finish job step.");
  return (data as JobStep | null) ?? null;
}

/** Mark a step 'failed' with a structured error JSON (ownership-checked). */
export async function failJobStep(
  profileId: string,
  stepId: string,
  error: Record<string, unknown> | string
): Promise<JobStep | null> {
  const errorJson = typeof error === "string" ? { message: error } : error;

  const { data, error: dbError } = await supabaseServer
    .from(JOB_STEPS_TABLE)
    .update({
      status: "failed",
      error: errorJson,
      finished_at: new Date().toISOString(),
    })
    .eq("id", stepId)
    .eq("profile_id", profileId)
    .select("*")
    .maybeSingle();

  handleError(dbError, "Failed to mark job step failed.");
  return (data as JobStep | null) ?? null;
}

/** List steps for a job in chronological order (ownership-checked). */
export async function listJobSteps(
  profileId: string,
  jobId: string
): Promise<JobStep[]> {
  const { data, error } = await supabaseServer
    .from(JOB_STEPS_TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .eq("job_id", jobId)
    .order("created_at", { ascending: true });

  handleError(error, "Failed to list job steps.");
  return (data as JobStep[] | null) ?? [];
}
