import { isMissingDbObject } from "@/lib/generation-db-errors";
import { supabaseServer } from "@/lib/supabase-server";
import {
  parseSubmissionFenceSnapshot,
  parseProviderSubmissionClaimResult,
  type ProviderSubmissionClaimResult,
  type SubmissionFenceSnapshot,
} from "./submission-fence-pure";

const TABLE = "generation_provider_submissions";

function fenceMissingHint(): Error {
  return new Error(
    "Database table generation_provider_submissions is missing. Run: npm run db:setup — or apply supabase/migrations/067_provider_submission_fence.sql.",
  );
}

export async function reserveProviderSubmission(params: {
  profileId: string;
  jobId: string;
  generationRequestId: string;
  slotKey: string;
}): Promise<SubmissionFenceSnapshot> {
  const { data, error } = await supabaseServer.rpc("krakatoa_reserve_provider_submission", {
    p_profile_id: params.profileId,
    p_job_id: params.jobId,
    p_generation_request_id: params.generationRequestId,
    p_slot_key: params.slotKey,
  });

  if (error) {
    if (
      isMissingDbObject(error.message, TABLE) ||
      isMissingDbObject(error.message, "krakatoa_reserve_provider_submission")
    ) {
      throw fenceMissingHint();
    }
    throw new Error(error.message || "reserveProviderSubmission RPC failed");
  }

  return parseSubmissionFenceSnapshot((data ?? {}) as Record<string, unknown>);
}

export async function claimProviderSubmission(params: {
  profileId: string;
  submissionId: string;
}): Promise<ProviderSubmissionClaimResult> {
  const { data, error } = await supabaseServer.rpc("krakatoa_claim_provider_submission", {
    p_profile_id: params.profileId,
    p_submission_id: params.submissionId,
  });

  if (error) {
    if (isMissingDbObject(error.message, "krakatoa_claim_provider_submission")) {
      throw fenceMissingHint();
    }
    throw new Error(error.message || "claimProviderSubmission RPC failed");
  }

  return parseProviderSubmissionClaimResult((data ?? {}) as Record<string, unknown>);
}

export async function markProviderSubmissionSubmitted(params: {
  profileId: string;
  submissionId: string;
  predictionId: string;
}): Promise<boolean> {
  const { data, error } = await supabaseServer.rpc("krakatoa_mark_provider_submission_submitted", {
    p_profile_id: params.profileId,
    p_submission_id: params.submissionId,
    p_prediction_id: params.predictionId,
  });

  if (error) {
    if (isMissingDbObject(error.message, "krakatoa_mark_provider_submission_submitted")) {
      throw fenceMissingHint();
    }
    throw new Error(error.message || "markProviderSubmissionSubmitted RPC failed");
  }

  return data === true;
}

export async function completeProviderSubmission(params: {
  profileId: string;
  submissionId: string;
  predictionId?: string | null;
  terminalState: "completed" | "failed" | "timed_out";
  errorJson?: Record<string, unknown> | null;
}): Promise<boolean> {
  const predictionId =
    typeof params.predictionId === "string" && params.predictionId.trim()
      ? params.predictionId.trim()
      : null;

  const { data, error } = await supabaseServer.rpc("krakatoa_complete_provider_submission", {
    p_profile_id: params.profileId,
    p_submission_id: params.submissionId,
    p_prediction_id: predictionId,
    p_terminal_state: params.terminalState,
    p_error_json: params.errorJson ?? null,
  });

  if (error) {
    if (isMissingDbObject(error.message, "krakatoa_complete_provider_submission")) {
      throw fenceMissingHint();
    }
    throw new Error(error.message || "completeProviderSubmission RPC failed");
  }

  return data === true;
}

export async function completeWorkflowProviderSuccess(params: {
  profileId: string;
  jobId: string;
  generationRequestId: string;
  submissionId: string;
  predictionId: string;
}): Promise<{ committed: boolean; shouldContinue: boolean; reason?: string }> {
  const { data, error } = await supabaseServer.rpc(
    "krakatoa_complete_workflow_provider_success",
    {
      p_profile_id: params.profileId,
      p_job_id: params.jobId,
      p_generation_request_id: params.generationRequestId,
      p_submission_id: params.submissionId,
      p_prediction_id: params.predictionId,
    },
  );

  if (error) {
    if (isMissingDbObject(error.message, "krakatoa_complete_workflow_provider_success")) {
      throw fenceMissingHint();
    }
    throw new Error(error.message || "completeWorkflowProviderSuccess RPC failed");
  }

  const row = (data ?? {}) as Record<string, unknown>;
  return {
    committed: row.committed === true,
    shouldContinue: row.shouldContinue === true,
    reason: typeof row.reason === "string" ? row.reason : undefined,
  };
}

export type UnknownSubmissionTimeoutResult =
  | { action: "timed_out" | "stop_won" | "missing" }
  | {
      action: "concurrent_terminal";
      state: "completed" | "failed" | "timed_out";
      predictionId: string | null;
      errorJson: Record<string, unknown> | null;
    };

export async function markProviderSubmissionUnknownTimeout(params: {
  profileId: string;
  jobId: string;
  generationRequestId: string;
  submissionId: string;
  errorJson: Record<string, unknown>;
}): Promise<UnknownSubmissionTimeoutResult> {
  const { data, error } = await supabaseServer.rpc(
    "krakatoa_mark_provider_submission_unknown_timeout",
    {
      p_profile_id: params.profileId,
      p_job_id: params.jobId,
      p_generation_request_id: params.generationRequestId,
      p_submission_id: params.submissionId,
      p_error_json: params.errorJson,
    },
  );

  if (error) {
    if (isMissingDbObject(error.message, "krakatoa_mark_provider_submission_unknown_timeout")) {
      throw fenceMissingHint();
    }
    throw new Error(error.message || "markProviderSubmissionUnknownTimeout RPC failed");
  }

  const row = (data ?? {}) as Record<string, unknown>;
  if (
    row.action === "timed_out" ||
    row.action === "stop_won" ||
    row.action === "missing"
  ) {
    return { action: row.action };
  }
  if (row.action !== "concurrent_terminal") {
    throw new Error("markProviderSubmissionUnknownTimeout: unexpected action");
  }
  const state = row.state;
  if (state !== "completed" && state !== "failed" && state !== "timed_out") {
    throw new Error("markProviderSubmissionUnknownTimeout: invalid terminal state");
  }
  return {
    action: "concurrent_terminal",
    state,
    predictionId: typeof row.predictionId === "string" ? row.predictionId : null,
    errorJson:
      row.errorJson && typeof row.errorJson === "object"
        ? (row.errorJson as Record<string, unknown>)
        : null,
  };
}

export async function getProviderSubmission(params: {
  profileId: string;
  submissionId: string;
}): Promise<SubmissionFenceSnapshot | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select(
      "id, state, prediction_id, reserved_at, submitted_at, completed_at, error_json, generation_request_id",
    )
    .eq("id", params.submissionId)
    .eq("profile_id", params.profileId)
    .maybeSingle();

  if (error) {
    if (isMissingDbObject(error.message, TABLE)) throw fenceMissingHint();
    throw new Error(error.message || "getProviderSubmission read failed");
  }
  if (!data) return null;

  const row = data as {
    id: string;
    state: string;
    prediction_id: string | null;
    reserved_at: string;
    submitted_at: string | null;
    completed_at: string | null;
    error_json: Record<string, unknown> | null;
  };

  return parseSubmissionFenceSnapshot({
    action: "existing",
    submissionId: row.id,
    state: row.state,
    predictionId: row.prediction_id,
    reservedAt: row.reserved_at,
    submittedAt: row.submitted_at,
    completedAt: row.completed_at,
    errorJson: row.error_json,
  });
}

