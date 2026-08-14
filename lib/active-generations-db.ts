import { supabaseServer } from "@/lib/supabase-server";
import {
  describeJob,
  FAILED_LOOKBACK_MS,
  LIVE_JOB_STATUSES,
  humanizePhase,
  matchRequestsToJobs,
  type ActiveGeneration,
  type MatchableRequest,
} from "@/lib/active-generations-pure";

const JOBS_LIMIT = 20;
const FAILED_LIMIT = 10;

type JobRow = {
  id: string;
  job_type: string;
  status: string;
  input: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  created_at: string;
};

type RequestRow = {
  job_id: string | null;
  idempotency_key: string;
  cancel_allowed: boolean | null;
};

type StepRow = {
  job_id: string;
  step_key: string;
  created_at: string;
};

export async function listActiveGenerations(profileId: string): Promise<ActiveGeneration[]> {
  const failedSince = new Date(Date.now() - FAILED_LOOKBACK_MS).toISOString();

  const [liveRes, failedRes] = await Promise.all([
    supabaseServer
      .from("jobs")
      .select("id, job_type, status, input, error, created_at")
      .eq("profile_id", profileId)
      .in("status", [...LIVE_JOB_STATUSES])
      .order("created_at", { ascending: false })
      .limit(JOBS_LIMIT),
    supabaseServer
      .from("jobs")
      .select("id, job_type, status, input, error, created_at")
      .eq("profile_id", profileId)
      .eq("status", "failed")
      .gte("updated_at", failedSince)
      .order("updated_at", { ascending: false })
      .limit(FAILED_LIMIT),
  ]);

  if (liveRes.error) throw new Error(liveRes.error.message);
  if (failedRes.error) throw new Error(failedRes.error.message);

  const byId = new Map<string, JobRow>();
  for (const row of [...(liveRes.data ?? []), ...(failedRes.data ?? [])] as JobRow[]) {
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  const jobs = Array.from(byId.values()).sort(
    (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
  );
  if (jobs.length === 0) return [];

  const jobIds = jobs.map((j) => j.id);

  const [linkedRes, stepRes] = await Promise.all([
    supabaseServer
      .from("generation_requests")
      .select("job_id, idempotency_key, cancel_allowed")
      .eq("profile_id", profileId)
      .in("job_id", jobIds),
    supabaseServer
      .from("job_steps")
      .select("job_id, step_key, created_at")
      .eq("profile_id", profileId)
      .in("job_id", jobIds)
      .eq("status", "running")
      .order("created_at", { ascending: false }),
  ]);

  if (linkedRes.error) {
    console.warn("[active-generations] generation_requests:", linkedRes.error.message);
  }
  if (stepRes.error) {
    console.warn("[active-generations] job_steps:", stepRes.error.message);
  }

  const requests: MatchableRequest[] = ((linkedRes.data ?? []) as RequestRow[]).map((row) => ({
    jobId: row.job_id,
    idempotencyKey: row.idempotency_key,
    cancelAllowed: row.cancel_allowed !== false,
  }));
  const matched = matchRequestsToJobs(
    jobs.map((j) => ({ id: j.id })),
    requests,
  );

  const phaseByJob = new Map<string, string>();
  for (const step of (stepRes.data ?? []) as StepRow[]) {
    if (!phaseByJob.has(step.job_id)) phaseByJob.set(step.job_id, step.step_key);
  }

  const out: ActiveGeneration[] = [];
  for (const job of jobs) {
    const link = matched.get(job.id);
    const described = describeJob({
      jobId: job.id,
      jobType: job.job_type,
      status: job.status,
      createdAt: job.created_at,
      input: job.input,
      error: job.error,
      phase: humanizePhase(phaseByJob.get(job.id) ?? null),
      idempotencyKey: link?.idempotencyKey ?? null,
      cancelAllowed: link?.cancelAllowed ?? false,
    });
    if (described) out.push(described);
  }
  return out.slice(0, JOBS_LIMIT);
}
