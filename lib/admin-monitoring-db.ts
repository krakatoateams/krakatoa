import { supabaseServer } from "@/lib/supabase-server";
import { embeddedEmail, type ProfileEmbed } from "@/lib/admin-metrics-db";
import { parseRecoveryManifest } from "@/lib/pipeline-recovery/manifest";
import { classifyJobFlags, type JobFlag } from "@/lib/admin-monitoring-flags";

/**
 * Read-only cross-user generation monitoring for the admin panel.
 *
 * Adds no tables: every field is already persisted somewhere, it just was never
 * joined for an admin. Sources are jobs, job_steps, credit_transactions,
 * generation_requests, generation_predictions and jobs.output.recovery.
 *
 * Queries are batched (one .in() per side table) so the list stays 5 round trips
 * regardless of row count — never N+1 per job.
 */

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;
const STEP_ROW_CAP = 4000;
const ACTIVE_STATUSES = ["queued", "running", "recoverable"] as const;

export type MonitoringStep = {
  id: string;
  step_key: string;
  step_name: string | null;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  error: Record<string, unknown> | null;
  input?: Record<string, unknown> | null;
  output?: Record<string, unknown> | null;
  created_at: string;
};

export type MonitoringRow = {
  id: string;
  profile_id: string;
  email: string | null;
  tool: string;
  job_type: string;
  status: string;
  provider: string | null;
  model: string | null;
  cost_credits: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  error: Record<string, unknown> | null;
  errorCode: string | null;
  currentStep: MonitoringStep | null;
  stepCount: number;
  failedStepKeys: string[];
  spentCredits: number;
  refundedCredits: number;
  cancelRequested: boolean;
  cancelAllowed: boolean;
  cancelRequestedAt: string | null;
  requestStatus: string | null;
  predictionCount: number;
  recoveryStep: string | null;
  resumeAttempts: number;
  recoveryExpiresAt: string | null;
  flags: JobFlag[];
};

const COUNTED_STATUSES = [
  "running",
  "queued",
  "recoverable",
  "failed",
  "cancelled",
  "succeeded",
] as const;
type CountedStatus = (typeof COUNTED_STATUSES)[number];

function isCountedStatus(s: string): s is CountedStatus {
  return (COUNTED_STATUSES as readonly string[]).includes(s);
}

export type MonitoringCounts = Record<CountedStatus, number> & {
  anomalies: Record<JobFlag, number>;
};

type JobRow = {
  id: string;
  profile_id: string;
  tool: string;
  job_type: string;
  status: string;
  provider: string | null;
  model: string | null;
  cost_credits: number;
  input: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
  profiles?: ProfileEmbed;
};

function ms(iso: string | null | undefined): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
}

function errorCodeOf(error: Record<string, unknown> | null): string | null {
  const code = error?.code;
  return typeof code === "string" ? code : null;
}

/** Batched side-table reads keyed by job_id. Empty ids short-circuits the round trip. */
async function fetchByJobIds<T>(
  table: string,
  columns: string,
  ids: string[],
  rowCap = STEP_ROW_CAP
): Promise<T[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabaseServer
    .from(table)
    .select(columns)
    .in("job_id", ids)
    .limit(rowCap);
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data as unknown as T[] | null) ?? [];
}

export async function getAdminMonitoring(options?: {
  windowHours?: number;
  tool?: string;
  status?: string;
  flag?: JobFlag;
  limit?: number;
}): Promise<{ rows: MonitoringRow[]; counts: MonitoringCounts; capped: boolean }> {
  const windowHours = Math.min(Math.max(options?.windowHours ?? 24, 1), 24 * 30);
  const limit = Math.min(options?.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  // Always include everything still in flight, however old — a job stuck for two
  // days is exactly what this panel exists to surface.
  let query = supabaseServer
    .from("jobs")
    .select(
      "id, profile_id, tool, job_type, status, provider, model, cost_credits, input, output, error, created_at, started_at, finished_at, updated_at, profiles(email)"
    )
    .or(`status.in.(${ACTIVE_STATUSES.join(",")}),created_at.gte.${since}`)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (options?.tool) query = query.eq("tool", options.tool);
  if (options?.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error) throw new Error(`jobs: ${error.message}`);
  const jobs = (data as unknown as JobRow[] | null) ?? [];
  const ids = jobs.map((j) => j.id);

  const [steps, txs, requests, predictions] = await Promise.all([
    fetchByJobIds<{
      id: string;
      job_id: string;
      step_key: string;
      step_name: string | null;
      status: string;
      started_at: string | null;
      finished_at: string | null;
      error: Record<string, unknown> | null;
      created_at: string;
    }>(
      "job_steps",
      "id, job_id, step_key, step_name, status, started_at, finished_at, error, created_at",
      ids
    ),
    fetchByJobIds<{ job_id: string; type: string; amount: number }>(
      "credit_transactions",
      "job_id, type, amount",
      ids
    ),
    fetchByJobIds<{
      job_id: string;
      status: string;
      cancel_requested: boolean;
      cancel_allowed: boolean;
      updated_at: string;
    }>(
      "generation_requests",
      "job_id, status, cancel_requested, cancel_allowed, updated_at",
      ids
    ),
    fetchByJobIds<{ job_id: string }>("generation_predictions", "job_id", ids),
  ]);

  // Collapse the side tables into per-job lookups.
  const lastStep = new Map<string, MonitoringStep>();
  const stepCount = new Map<string, number>();
  const failedSteps = new Map<string, string[]>();
  for (const s of steps) {
    stepCount.set(s.job_id, (stepCount.get(s.job_id) ?? 0) + 1);
    const prev = lastStep.get(s.job_id);
    if (!prev || ms(s.created_at) >= ms(prev.created_at)) lastStep.set(s.job_id, s);
    if (s.status === "failed") {
      failedSteps.set(s.job_id, [...(failedSteps.get(s.job_id) ?? []), s.step_key]);
    }
  }

  const credits = new Map<string, { spent: number; refunded: number }>();
  for (const t of txs) {
    if (t.type !== "spend" && t.type !== "refund") continue;
    const agg = credits.get(t.job_id) ?? { spent: 0, refunded: 0 };
    if (t.type === "spend") agg.spent += t.amount ?? 0;
    else agg.refunded += t.amount ?? 0;
    credits.set(t.job_id, agg);
  }

  const requestByJob = new Map(requests.map((r) => [r.job_id, r]));

  const predictionCount = new Map<string, number>();
  for (const p of predictions) {
    predictionCount.set(p.job_id, (predictionCount.get(p.job_id) ?? 0) + 1);
  }

  const nowMs = Date.now();
  const rows: MonitoringRow[] = jobs.map((j) => {
    const credit = credits.get(j.id) ?? { spent: 0, refunded: 0 };
    const req = requestByJob.get(j.id);
    const recovery = parseRecoveryManifest(j.output);
    const errorCode = errorCodeOf(j.error);

    const flags = classifyJobFlags({
      status: j.status,
      errorCode,
      updatedAtMs: ms(j.updated_at),
      nowMs,
      cancelRequested: req?.cancel_requested ?? false,
      cancelRequestedAtMs: req ? ms(req.updated_at) : null,
      cancelAllowed: req?.cancel_allowed ?? true,
      spentCredits: credit.spent,
      refundedCredits: credit.refunded,
      resumeAttempts: recovery?.resumeAttempts,
    });

    return {
      id: j.id,
      profile_id: j.profile_id,
      email: embeddedEmail(j.profiles),
      tool: j.tool,
      job_type: j.job_type,
      status: j.status,
      provider: j.provider,
      model: j.model,
      cost_credits: j.cost_credits,
      created_at: j.created_at,
      started_at: j.started_at,
      finished_at: j.finished_at,
      updated_at: j.updated_at,
      error: j.error,
      errorCode,
      currentStep: lastStep.get(j.id) ?? null,
      stepCount: stepCount.get(j.id) ?? 0,
      failedStepKeys: failedSteps.get(j.id) ?? [],
      spentCredits: credit.spent,
      refundedCredits: credit.refunded,
      cancelRequested: req?.cancel_requested ?? false,
      cancelAllowed: req?.cancel_allowed ?? true,
      cancelRequestedAt: req?.cancel_requested ? req.updated_at : null,
      requestStatus: req?.status ?? null,
      predictionCount: predictionCount.get(j.id) ?? 0,
      recoveryStep: recovery?.step ?? null,
      resumeAttempts: recovery?.resumeAttempts ?? 0,
      recoveryExpiresAt: recovery?.expiresAt ?? null,
      flags,
    };
  });

  const counts: MonitoringCounts = {
    running: 0,
    queued: 0,
    recoverable: 0,
    failed: 0,
    cancelled: 0,
    succeeded: 0,
    anomalies: { stuck: 0, cancel_not_honored: 0, refund_missing: 0 },
  };
  for (const r of rows) {
    if (isCountedStatus(r.status)) counts[r.status] += 1;
    for (const f of r.flags) counts.anomalies[f] += 1;
  }

  const flag = options?.flag;
  const filtered = flag ? rows.filter((r) => r.flags.includes(flag)) : rows;
  return { rows: filtered, counts, capped: jobs.length >= limit };
}

export type MonitoringDetail = {
  job: JobRow & { email: string | null; errorCode: string | null };
  steps: MonitoringStep[];
  transactions: {
    id: string;
    type: string;
    direction: string;
    status: string;
    amount: number;
    description: string | null;
    idempotency_key: string | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
  }[];
  request: {
    id: string;
    idempotency_key: string;
    tool_key: string;
    route_key: string;
    status: string;
    cancel_requested: boolean;
    cancel_allowed: boolean;
    error_json: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
  } | null;
  predictions: {
    id: string;
    prediction_id: string;
    kind: string | null;
    status: string;
    created_at: string;
  }[];
  assets: {
    id: string;
    asset_type: string;
    status: string;
    storage_path: string | null;
    created_at: string;
  }[];
  recovery: ReturnType<typeof parseRecoveryManifest>;
  flags: JobFlag[];
};

/** Everything known about one job — the drill-down behind a monitoring row. */
export async function getAdminJobDetail(jobId: string): Promise<MonitoringDetail | null> {
  const { data, error } = await supabaseServer
    .from("jobs")
    .select(
      "id, profile_id, tool, job_type, status, provider, model, cost_credits, input, output, error, created_at, started_at, finished_at, updated_at, profiles(email)"
    )
    .eq("id", jobId)
    .maybeSingle();
  if (error) throw new Error(`jobs: ${error.message}`);
  if (!data) return null;
  const job = data as unknown as JobRow;

  const ids = [jobId];
  const [steps, transactions, requests, predictions, assets] = await Promise.all([
    fetchByJobIds<MonitoringStep & { job_id: string }>(
      "job_steps",
      "id, job_id, step_key, step_name, status, input, output, error, started_at, finished_at, created_at",
      ids
    ),
    fetchByJobIds<MonitoringDetail["transactions"][number] & { job_id: string }>(
      "credit_transactions",
      "id, job_id, type, direction, status, amount, description, idempotency_key, metadata, created_at",
      ids
    ),
    fetchByJobIds<NonNullable<MonitoringDetail["request"]> & { job_id: string }>(
      "generation_requests",
      "id, job_id, idempotency_key, tool_key, route_key, status, cancel_requested, cancel_allowed, error_json, created_at, updated_at",
      ids
    ),
    fetchByJobIds<MonitoringDetail["predictions"][number] & { job_id: string }>(
      "generation_predictions",
      "id, job_id, prediction_id, kind, status, created_at",
      ids
    ),
    fetchByJobIds<MonitoringDetail["assets"][number] & { job_id: string }>(
      "assets",
      "id, job_id, asset_type, status, storage_path, created_at",
      ids
    ),
  ]);

  steps.sort((a, b) => ms(a.created_at) - ms(b.created_at));
  transactions.sort((a, b) => ms(a.created_at) - ms(b.created_at));

  const request = requests[0] ?? null;
  const recovery = parseRecoveryManifest(job.output);
  const errorCode = errorCodeOf(job.error);
  const spent = transactions
    .filter((t) => t.type === "spend")
    .reduce((s, t) => s + (t.amount ?? 0), 0);
  const refunded = transactions
    .filter((t) => t.type === "refund")
    .reduce((s, t) => s + (t.amount ?? 0), 0);

  return {
    job: { ...job, email: embeddedEmail(job.profiles), errorCode },
    steps,
    transactions,
    request,
    predictions,
    assets,
    recovery,
    flags: classifyJobFlags({
      status: job.status,
      errorCode,
      updatedAtMs: ms(job.updated_at),
      nowMs: Date.now(),
      cancelRequested: request?.cancel_requested ?? false,
      cancelRequestedAtMs: request ? ms(request.updated_at) : null,
      cancelAllowed: request?.cancel_allowed ?? true,
      spentCredits: spent,
      refundedCredits: refunded,
      resumeAttempts: recovery?.resumeAttempts,
    }),
  };
}

export type FailedStepAggregate = {
  step_key: string;
  tool: string | null;
  count: number;
  lastAt: string;
  lastMessage: string | null;
};

/**
 * Which pipeline steps are failing most across all users. Answers "is Rendi
 * flaky today or is it just this one job?" without opening every job.
 */
export async function getAdminFailedStepAggregates(options?: {
  windowHours?: number;
}): Promise<FailedStepAggregate[]> {
  const windowHours = Math.min(Math.max(options?.windowHours ?? 24, 1), 24 * 30);
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabaseServer
    .from("job_steps")
    .select("step_key, error, created_at, jobs(tool)")
    .eq("status", "failed")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw new Error(`job_steps: ${error.message}`);

  const rows = (data as unknown as
    | {
        step_key: string;
        error: Record<string, unknown> | null;
        created_at: string;
        jobs?: { tool?: string | null } | { tool?: string | null }[] | null;
      }[]
    | null) ?? [];

  const map = new Map<string, FailedStepAggregate>();
  for (const r of rows) {
    const joined = Array.isArray(r.jobs) ? (r.jobs[0] ?? null) : r.jobs;
    const tool = joined?.tool ?? null;
    const key = `${tool}::${r.step_key}`;
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      continue;
    }
    const message = r.error?.message;
    map.set(key, {
      step_key: r.step_key,
      tool,
      count: 1,
      lastAt: r.created_at,
      lastMessage: typeof message === "string" ? message : null,
    });
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
