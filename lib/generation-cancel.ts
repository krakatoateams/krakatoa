import type Replicate from "replicate";
import {
  ReplicateCancellationError,
  type ReplicateRunHooks,
} from "@/lib/replicate-server";
import { isMissingDbObject } from "@/lib/generation-db-errors";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * Generation cancellation data access (Cancel-in-flight v1).
 *
 * Pairs with migration 023. The cancel flow keys off the always-present
 * `generation_requests` row (the client's Idempotency-Key handle), not the
 * best-effort `jobs` row:
 *   - recordPrediction()  — the generate route stores each Replicate prediction
 *                           id as it is created (best-effort, never throws).
 *   - requestCancel()     — the cancel endpoint flips generation_requests
 *                           .cancel_requested true (ownership-checked).
 *   - isCancelRequested() — the generate route can poll this between steps to
 *                           abort early before a not-yet-created provider call.
 *   - listPredictionIds() / cancelReplicatePredictions() — the cancel endpoint
 *                           stops every in-flight Replicate prediction.
 *
 * Every query is scoped by profile_id (the ownership boundary). Service role
 * bypasses RLS; ownership is enforced here in application code.
 */

const REQUESTS_TABLE = "generation_requests";
const PREDICTIONS_TABLE = "generation_predictions";

function missingHint(): Error {
  return new Error(
    "Database object generation_predictions / generation_requests.cancel_requested is missing. Run: npm run db:setup — or apply supabase/migrations/023_generation_cancellation.sql."
  );
}

/**
 * Record a created Replicate prediction for an attempt. Best-effort and never
 * throws (callers invoke it fire-and-forget from the SDK progress callback).
 * Upsert keeps it idempotent across the multiple progress ticks per prediction.
 */
export async function recordPrediction(params: {
  generationRequestId: string;
  profileId: string;
  predictionId: string;
  jobId?: string | null;
  kind?: string;
  status?: string;
}): Promise<void> {
  try {
    const { error } = await supabaseServer
      .from(PREDICTIONS_TABLE)
      .upsert(
        {
          generation_request_id: params.generationRequestId,
          job_id: params.jobId ?? null,
          profile_id: params.profileId,
          prediction_id: params.predictionId,
          kind: params.kind ?? null,
          status: params.status ?? "starting",
        },
        { onConflict: "generation_request_id,prediction_id" }
      );
    if (error) console.warn("[generation-cancel] recordPrediction failed:", error.message);
  } catch (e) {
    console.warn("[generation-cancel] recordPrediction threw:", e);
  }
}

/**
 * Build a fire-and-forget onPrediction hook bound to an attempt. Returns
 * undefined when there is no generation_request id to key on (then nothing is
 * recorded and the attempt simply cannot be cancelled mid-flight).
 */
export function makePredictionRecorder(params: {
  generationRequestId: string | null;
  profileId: string | null;
  jobId?: string | null;
  kind?: string;
}): ((tick: { id: string; status: string }) => void) | undefined {
  const { generationRequestId, profileId } = params;
  if (!generationRequestId || !profileId) return undefined;
  return (tick) => {
    void recordPrediction({
      generationRequestId,
      profileId,
      jobId: params.jobId ?? null,
      predictionId: tick.id,
      kind: params.kind,
      status: tick.status,
    });
  };
}

/**
 * Hooks for `runReplicateWithRetry`: record prediction ids + poll cancel_requested
 * on every provider wait tick so UI cancel stops Replicate without waiting for
 * the full generation to finish.
 */
export function makeReplicateCancelHooks(params: {
  generationRequestId: string | null;
  profileId: string | null;
  jobId?: string | null;
  kind?: string;
}): ReplicateRunHooks | undefined {
  const { generationRequestId, profileId } = params;
  if (!generationRequestId || !profileId) return undefined;
  const onPrediction = makePredictionRecorder(params);
  return {
    onPrediction,
    abortCheck: () => assertNotCancelled(profileId, generationRequestId),
  };
}

/** Flip cancel_requested true for an attempt (ownership-checked). Returns true when a row matched. */
export async function requestCancel(
  profileId: string,
  generationRequestId: string
): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from(REQUESTS_TABLE)
    .update({ cancel_requested: true })
    .eq("id", generationRequestId)
    .eq("profile_id", profileId)
    .select("id")
    .maybeSingle();

  if (error) {
    if (
      isMissingDbObject(error.message, REQUESTS_TABLE) ||
      isMissingDbObject(error.message, PREDICTIONS_TABLE)
    ) {
      throw missingHint();
    }
    throw new Error(error.message || "Failed to request cancellation.");
  }
  return !!data;
}

const CANCEL_READ_RETRIES = 2;

/** Read whether cancellation was requested. On persistent DB error, returns true (fail-closed). */
export async function isCancelRequested(
  profileId: string,
  generationRequestId: string
): Promise<boolean> {
  for (let attempt = 0; attempt < CANCEL_READ_RETRIES; attempt++) {
    try {
      const { data, error } = await supabaseServer
        .from(REQUESTS_TABLE)
        .select("cancel_requested")
        .eq("id", generationRequestId)
        .eq("profile_id", profileId)
        .maybeSingle();
      if (!error) {
        return !!(data as { cancel_requested?: boolean } | null)?.cancel_requested;
      }
      if (attempt < CANCEL_READ_RETRIES - 1) continue;
      console.error(
        "[generation-cancel] isCancelRequested DB error after retry:",
        error.message
      );
    } catch (e) {
      if (attempt < CANCEL_READ_RETRIES - 1) continue;
      console.error("[generation-cancel] isCancelRequested threw after retry:", e);
    }
  }
  // ponytail: fail-closed — safer to refund than charge when cancel state is unknown
  return true;
}

/** Throws when the user requested cancellation for this attempt. */
export async function assertNotCancelled(
  profileId: string,
  generationRequestId: string
): Promise<void> {
  if (await isCancelRequested(profileId, generationRequestId)) {
    throw new ReplicateCancellationError();
  }
}

/** List every recorded Replicate prediction id for an attempt (ownership-checked). */
export async function listPredictionIds(
  profileId: string,
  generationRequestId: string
): Promise<string[]> {
  const { data, error } = await supabaseServer
    .from(PREDICTIONS_TABLE)
    .select("prediction_id")
    .eq("generation_request_id", generationRequestId)
    .eq("profile_id", profileId);

  if (error) {
    if (isMissingDbObject(error.message, PREDICTIONS_TABLE)) throw missingHint();
    throw new Error(error.message || "Failed to list predictions.");
  }
  return ((data as { prediction_id: string }[] | null) ?? [])
    .map((r) => r.prediction_id)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

/**
 * Cancel a set of Replicate predictions. Best-effort: a prediction that already
 * finished / was already cancelled simply errors and is ignored. Never throws.
 */
export async function cancelReplicatePredictions(
  replicate: Replicate,
  predictionIds: string[]
): Promise<{ requested: number; cancelled: number }> {
  let cancelled = 0;
  await Promise.allSettled(
    predictionIds.map(async (id) => {
      try {
        await replicate.predictions.cancel(id);
        cancelled += 1;
      } catch (e) {
        console.warn(`[generation-cancel] cancel prediction ${id} failed:`, e);
      }
    })
  );
  return { requested: predictionIds.length, cancelled };
}
