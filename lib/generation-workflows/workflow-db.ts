import { isMissingDbObject } from "@/lib/generation-db-errors";
import { supabaseServer } from "@/lib/supabase-server";

const JOBS_TABLE = "jobs";
const REQUESTS_TABLE = "generation_requests";

export type GenerationRequestStopRow = {
  id: string;
  job_id: string | null;
  cancel_requested: boolean;
  cancel_allowed: boolean | null;
  provider_committed_at: string | null;
  status: string;
  response_json: Record<string, unknown> | null;
  error_json: Record<string, unknown> | null;
};

function jobsMissingHint(): Error {
  return new Error(
    "Database columns jobs.execution_backend / jobs.workflow_run_id / jobs.heartbeat_at are missing. Run: npm run db:setup — or apply supabase/migrations/064_durable_generation_workflows.sql.",
  );
}

function requestsMissingHint(): Error {
  return new Error(
    "Database column generation_requests.provider_committed_at is missing. Run: npm run db:setup — or apply supabase/migrations/064_durable_generation_workflows.sql.",
  );
}

function dismissedMissingHint(): Error {
  return new Error(
    "Database column jobs.dismissed_at is missing. Run: npm run db:setup — or apply supabase/migrations/065_generation_job_dismissal.sql.",
  );
}

function settlementMissingHint(): Error {
  return new Error(
    "Database functions krakatoa_settle_generation_stop / krakatoa_mark_workflow_provider_committed are missing. Run: npm run db:setup — or apply supabase/migrations/066_atomic_generation_settlement.sql.",
  );
}

/** Stamp workflow run metadata after start() accepts a durable run. */
export async function attachWorkflowRun(params: {
  profileId: string;
  jobId: string;
  workflowRunId: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from(JOBS_TABLE)
    .update({
      execution_backend: "workflow",
      workflow_run_id: params.workflowRunId,
      heartbeat_at: now,
    })
    .eq("id", params.jobId)
    .eq("profile_id", params.profileId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (isMissingDbObject(error.message, JOBS_TABLE)) throw jobsMissingHint();
    throw new Error(error.message || "attachWorkflowRun update failed");
  }
  if (!data) {
    throw new Error("attachWorkflowRun: job not found");
  }
}

/** Liveness signal for workflow-era jobs (reconcile / active tiles). */
export async function touchJobHeartbeat(profileId: string, jobId: string): Promise<void> {
  const { data, error } = await supabaseServer
    .from(JOBS_TABLE)
    .update({ heartbeat_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("profile_id", profileId)
    .eq("execution_backend", "workflow")
    .select("id")
    .maybeSingle();

  if (error) {
    if (isMissingDbObject(error.message, JOBS_TABLE)) throw jobsMissingHint();
    throw new Error(error.message || "touchJobHeartbeat update failed");
  }
  if (!data) {
    throw new Error("touchJobHeartbeat: workflow job not found");
  }
}

export type AtomicSettleGenerationStopResult = {
  action: "noop_terminal" | "settled" | "settled_no_refund";
  refunded: boolean;
  refundEligible: boolean;
  replay?: boolean;
};

/** Atomic stop settlement — billing + job closure in one Postgres transaction. */
export async function atomicSettleGenerationStop(
  profileId: string,
  jobId: string,
): Promise<AtomicSettleGenerationStopResult> {
  const { data, error } = await supabaseServer.rpc("krakatoa_settle_generation_stop", {
    p_profile_id: profileId,
    p_job_id: jobId,
  });

  if (error) {
    if (
      isMissingDbObject(error.message, "krakatoa_settle_generation_stop") ||
      isMissingDbObject(error.message, JOBS_TABLE)
    ) {
      throw settlementMissingHint();
    }
    throw new Error(error.message || "atomicSettleGenerationStop RPC failed");
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const action = row.action;
  if (
    action !== "noop_terminal" &&
    action !== "settled" &&
    action !== "settled_no_refund"
  ) {
    throw new Error("atomicSettleGenerationStop: unexpected action");
  }

  return {
    action,
    refunded: row.refunded === true,
    refundEligible: row.refundEligible === true,
    replay: row.replay === true,
  };
}

export type AtomicFailWorkflowGenerationResult = {
  action: "failed" | "noop_terminal" | "stop_won" | "invalid";
  refunded: boolean;
  refundEligible: boolean;
  reason?: string;
};

/** Atomic workflow failure — refund eligibility is decided by provider commit state. */
export async function atomicFailWorkflowGeneration(params: {
  profileId: string;
  jobId: string;
  generationRequestId: string;
  errorJson: Record<string, unknown>;
  refund: boolean;
}): Promise<AtomicFailWorkflowGenerationResult> {
  const { data, error } = await supabaseServer.rpc("krakatoa_fail_workflow_generation", {
    p_profile_id: params.profileId,
    p_job_id: params.jobId,
    p_generation_request_id: params.generationRequestId,
    p_error_json: params.errorJson,
    p_refund_requested: params.refund,
  });

  if (error) {
    if (isMissingDbObject(error.message, "krakatoa_fail_workflow_generation")) {
      throw new Error(
        "Database function krakatoa_fail_workflow_generation is missing. Run: npm run db:setup — or apply supabase/migrations/072_workflow_failure_settlement.sql.",
      );
    }
    throw new Error(error.message || "atomicFailWorkflowGeneration RPC failed");
  }

  const row = (data ?? {}) as Record<string, unknown>;
  const action = row.action;
  if (
    action !== "failed" &&
    action !== "noop_terminal" &&
    action !== "stop_won" &&
    action !== "invalid"
  ) {
    throw new Error("atomicFailWorkflowGeneration: unexpected action");
  }

  return {
    action,
    refunded: row.refunded === true,
    refundEligible: row.refundEligible === true,
    reason: typeof row.reason === "string" ? row.reason : undefined,
  };
}

/**
 * Workflow/force-stop: set cancel_requested even when cancel_allowed=false.
 * Does not change legacy requestCancel() behavior.
 */
export type RequestWorkflowStopResult = {
  accepted: boolean;
  refundEligible: boolean;
  alreadyRequested: boolean;
  reason?: string;
  status?: string;
};

export async function requestWorkflowStop(params: {
  profileId: string;
  jobId: string;
  generationRequestId: string;
}): Promise<RequestWorkflowStopResult> {
  const { data, error } = await supabaseServer.rpc("krakatoa_request_generation_stop", {
    p_profile_id: params.profileId,
    p_job_id: params.jobId,
    p_generation_request_id: params.generationRequestId,
  });

  if (error) {
    if (
      isMissingDbObject(error.message, "krakatoa_request_generation_stop") ||
      isMissingDbObject(error.message, REQUESTS_TABLE)
    ) {
      throw settlementMissingHint();
    }
    throw new Error(error.message || "requestWorkflowStop RPC failed");
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    accepted: row.accepted === true,
    refundEligible: row.refundEligible === true,
    alreadyRequested: row.alreadyRequested === true,
    reason: typeof row.reason === "string" ? row.reason : undefined,
    status: typeof row.status === "string" ? row.status : undefined,
  };
}

/** Workflow stop poll — reads cancel_requested without legacy commit gate. */
export async function isWorkflowStopRequested(
  profileId: string,
  generationRequestId: string,
): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from(REQUESTS_TABLE)
    .select("cancel_requested")
    .eq("id", generationRequestId)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error) {
    if (isMissingDbObject(error.message, REQUESTS_TABLE)) throw requestsMissingHint();
    throw new Error(error.message || "isWorkflowStopRequested read failed");
  }
  return !!(data as { cancel_requested?: boolean } | null)?.cancel_requested;
}

export async function getGenerationRequestForJob(
  profileId: string,
  jobId: string,
): Promise<GenerationRequestStopRow | null> {
  const { data, error } = await supabaseServer
    .from(REQUESTS_TABLE)
    .select(
      "id, job_id, cancel_requested, cancel_allowed, provider_committed_at, status, response_json, error_json",
    )
    .eq("profile_id", profileId)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (isMissingDbObject(error.message, REQUESTS_TABLE)) throw requestsMissingHint();
    throw new Error(error.message || "getGenerationRequestForJob read failed");
  }
  return (data as GenerationRequestStopRow | null) ?? null;
}

/** Soft-dismiss a terminal failed/cancelled job from active tiles. */
export async function dismissGenerationJob(
  profileId: string,
  jobId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseServer
    .from(JOBS_TABLE)
    .update({ dismissed_at: now })
    .eq("id", jobId)
    .eq("profile_id", profileId)
    .in("status", ["failed", "cancelled"])
    .is("dismissed_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    if (isMissingDbObject(error.message, JOBS_TABLE)) throw dismissedMissingHint();
    throw new Error(error.message || "dismissGenerationJob update failed");
  }
  return !!data;
}
