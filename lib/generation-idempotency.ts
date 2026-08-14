import { supabaseServer } from "@/lib/supabase-server";
import {
  LOCK_TTL_MS,
  type GenerationRequestRow,
  type BeginResult,
  type LinkedJobRow,
  resolveLinkedJobBeginAction,
} from "./generation-idempotency-pure";

export * from "./generation-idempotency-pure";

/**
 * Generation request-level idempotency (Double-Charge Protection v1).
 *
 * Each generation route records a row in `generation_requests` BEFORE creating a
 * job, spending credits, or calling any provider. The unique(profile_id,
 * idempotency_key) constraint is the race-safe dedupe primitive. This module
 * NEVER calls providers and contains NO payment logic — it only reads/writes the
 * generation_requests table via the service-role client and enforces profile
 * ownership in every query.
 *
 * Keep aligned with supabase/migrations/008_generation_idempotency.sql.
 */

const TABLE = "generation_requests";

/** Replay or recoverable gate based on the generation_request's linked job. */
async function linkedJobBeginAction(
  profileId: string,
  existing: GenerationRequestRow,
): Promise<BeginResult | null> {
  if (!existing.job_id) return null;

  const { data, error } = await supabaseServer
    .from("jobs")
    .select("status, output, error")
    .eq("id", existing.job_id)
    .eq("profile_id", profileId)
    .maybeSingle();

  if (error || !data) return null;
  return resolveLinkedJobBeginAction(existing, data as LinkedJobRow);
}

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (
    error.message.includes("generation_requests") &&
    (error.message.includes("schema cache") || error.message.includes("does not exist"))
  ) {
    throw new Error(
      "Database table generation_requests is missing. Run: npm run db:setup — or apply supabase/migrations/008_generation_idempotency.sql."
    );
  }
  throw new Error(error.message || fallback);
}

export async function getExistingGenerationRequest(
  profileId: string,
  idempotencyKey: string,
): Promise<GenerationRequestRow | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  handleError(error, "Failed to read generation request.");
  return (data as GenerationRequestRow | null) ?? null;
}

/**
 * Insert-first idempotency gate. Returns an action the route must honor BEFORE
 * doing any job/spend/provider work:
 *   - proceed      : fresh row inserted, or a failed/stale row taken over.
 *   - replay       : a prior attempt already succeeded; return its stored response.
 *   - in_progress  : a prior attempt is still running (fresh lock) or a takeover
 *                    race was lost.
 *   - conflict     : the key was reused with a different request payload.
 */
export async function beginGenerationRequest(params: {
  profileId: string;
  idempotencyKey: string;
  routeKey: string;
  toolKey: string;
  requestHash: string;
}): Promise<BeginResult> {
  const lockedUntil = new Date(Date.now() + LOCK_TTL_MS).toISOString();

  const { data: inserted, error: insertError } = await supabaseServer
    .from(TABLE)
    .insert({
      profile_id: params.profileId,
      idempotency_key: params.idempotencyKey,
      route_key: params.routeKey,
      tool_key: params.toolKey,
      request_hash: params.requestHash,
      status: "started",
      locked_until: lockedUntil,
    })
    .select("id")
    .single();

  if (!insertError && inserted) {
    return { action: "proceed", id: (inserted as { id: string }).id };
  }

  if (insertError && (insertError as { code?: string }).code !== "23505") {
    handleError(insertError, "Failed to begin generation request.");
  }

  const existing = await getExistingGenerationRequest(params.profileId, params.idempotencyKey);
  if (!existing) {
    return { action: "in_progress" };
  }

  if (existing.request_hash !== params.requestHash) {
    return { action: "conflict" };
  }

  if (existing.status === "succeeded" && existing.response_json) {
    return { action: "replay", response: existing.response_json };
  }

  const linkedAction = await linkedJobBeginAction(params.profileId, existing);
  if (linkedAction) {
    return linkedAction;
  }

  const lockFresh =
    existing.status === "started" &&
    existing.locked_until !== null &&
    new Date(existing.locked_until).getTime() > Date.now();

  if (lockFresh) {
    return { action: "in_progress" };
  }

  const { data: takeover, error: takeoverError } = await supabaseServer
    .from(TABLE)
    .update({
      status: "started",
      request_hash: params.requestHash,
      route_key: params.routeKey,
      tool_key: params.toolKey,
      locked_until: lockedUntil,
      error_json: null,
      response_json: null,
      job_id: null,
      asset_id: null,
      cancel_requested: false,
      cancel_allowed: true,
    })
    .eq("id", existing.id)
    .eq("updated_at", existing.updated_at)
    .select("id")
    .maybeSingle();

  handleError(takeoverError, "Failed to take over generation request.");
  if (takeover) {
    return { action: "proceed", id: (takeover as { id: string }).id };
  }
  return { action: "in_progress" };
}

/** Link the in-flight generation_request to its job as soon as the job exists.
 *  Cancel-from-history keys off this; waiting until finish left a window where
 *  two concurrent gens could be paired by created_at guesswork. */
export async function attachGenerationRequestJob(params: {
  id: string;
  jobId: string;
}): Promise<void> {
  const { error } = await supabaseServer
    .from(TABLE)
    .update({ job_id: params.jobId })
    .eq("id", params.id);

  handleError(error, "Failed to attach job to generation request.");
}

export async function finishGenerationRequestSuccess(params: {
  id: string;
  jobId?: string | null;
  assetId?: string | null;
  responseJson: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseServer
    .from(TABLE)
    .update({
      status: "succeeded",
      job_id: params.jobId ?? null,
      asset_id: params.assetId ?? null,
      response_json: params.responseJson,
      error_json: null,
      locked_until: null,
    })
    .eq("id", params.id);

  handleError(error, "Failed to finalize generation request.");
}

export async function finishGenerationRequestFailure(params: {
  id: string;
  jobId?: string | null;
  errorJson: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseServer
    .from(TABLE)
    .update({
      status: "failed",
      job_id: params.jobId ?? null,
      error_json: params.errorJson,
      locked_until: null,
    })
    .eq("id", params.id);

  handleError(error, "Failed to record generation request failure.");
}

/** Mark idempotency row failed but keep job link for recoverable resume (blocks re-spend). */
export async function finishGenerationRequestRecoverable(params: {
  id: string;
  jobId: string;
  errorJson: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseServer
    .from(TABLE)
    .update({
      status: "failed",
      job_id: params.jobId,
      error_json: params.errorJson,
      locked_until: null,
    })
    .eq("id", params.id);

  handleError(error, "Failed to record recoverable generation request.");
}

/** Terminal close for generation_requests linked to a job (e.g. abandon/cancel recoverable). */
export async function finishGenerationRequestsForJob(params: {
  profileId: string;
  jobId: string;
  errorJson: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseServer
    .from(TABLE)
    .update({
      status: "failed",
      error_json: params.errorJson,
      locked_until: null,
    })
    .eq("profile_id", params.profileId)
    .eq("job_id", params.jobId)
    .neq("status", "succeeded");

  if (error) {
    console.warn("[generation-idempotency] finishGenerationRequestsForJob:", error.message);
  }
}

/** Mark linked generation_requests succeeded (e.g. after resume completes the job). */
export async function finishGenerationRequestsForJobSuccess(params: {
  profileId: string;
  jobId: string;
  responseJson: Record<string, unknown>;
  assetId?: string | null;
}): Promise<void> {
  const { error } = await supabaseServer
    .from(TABLE)
    .update({
      status: "succeeded",
      response_json: params.responseJson,
      error_json: null,
      locked_until: null,
      asset_id: params.assetId ?? null,
    })
    .eq("profile_id", params.profileId)
    .eq("job_id", params.jobId)
    .neq("status", "succeeded");

  if (error) {
    console.warn("[generation-idempotency] finishGenerationRequestsForJobSuccess:", error.message);
  }
}
