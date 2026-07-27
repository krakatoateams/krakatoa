import { isMissingDbObject } from "@/lib/generation-db-errors";
import { isCancellation } from "@/lib/replicate-server";
import { supabaseServer } from "@/lib/supabase-server";
import {
  commitLockedFromCancelAllowed,
  isRefundableUserCancellationPure,
} from "@/lib/generation-commit-pure";

const REQUESTS_TABLE = "generation_requests";
const MARK_COMMIT_RETRIES = 3;

function missingHint(): Error {
  return new Error(
    "Database column generation_requests.cancel_allowed is missing. Run: npm run db:setup — or apply supabase/migrations/055_generation_cancel_allowed.sql."
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Provider output committed — user cancel must not refund (see no-refund-after-replicate plan). */
export async function markProviderCommitted(params: {
  generationRequestId: string;
  profileId: string;
  reason?: string;
}): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MARK_COMMIT_RETRIES; attempt++) {
    try {
      const { data, error } = await supabaseServer
        .from(REQUESTS_TABLE)
        .update({
          cancel_allowed: false,
          cancel_requested: false,
        })
        .eq("id", params.generationRequestId)
        .eq("profile_id", params.profileId)
        .select("id")
        .maybeSingle();
      if (error) {
        if (isMissingDbObject(error.message, REQUESTS_TABLE)) throw missingHint();
        throw new Error(error.message || "markProviderCommitted update failed");
      }
      if (!data) {
        throw new Error("markProviderCommitted: generation request not found");
      }
      return;
    } catch (e) {
      lastError = e;
      if (e instanceof Error && e.message.includes("cancel_allowed is missing")) throw e;
      if (attempt < MARK_COMMIT_RETRIES - 1) {
        await sleep(250 * (attempt + 1));
      }
    }
  }
  const reason = params.reason ? ` (${params.reason})` : "";
  console.error("[generation-commit] markProviderCommitted failed after retries" + reason, lastError);
  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to lock generation request after provider commit");
}

export async function isProviderCommitLocked(
  profileId: string,
  generationRequestId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabaseServer
      .from(REQUESTS_TABLE)
      .select("cancel_allowed")
      .eq("id", generationRequestId)
      .eq("profile_id", profileId)
      .maybeSingle();
    if (error) {
      if (isMissingDbObject(error.message, REQUESTS_TABLE)) return false;
      console.error("[generation-commit] isProviderCommitLocked DB error:", error.message);
      // ponytail: fail-closed — unknown lock state blocks cancel/refund paths
      return true;
    }
    const row = data as { cancel_allowed?: boolean } | null;
    if (!row) {
      // ponytail: active attempt expects a row — treat missing as locked (fail-closed)
      return true;
    }
    return commitLockedFromCancelAllowed(row.cancel_allowed);
  } catch (e) {
    console.error("[generation-commit] isProviderCommitLocked threw:", e);
    return true;
  }
}

export async function readGenerationCancelAllowed(
  profileId: string,
  generationRequestId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabaseServer
      .from(REQUESTS_TABLE)
      .select("cancel_allowed, status")
      .eq("id", generationRequestId)
      .eq("profile_id", profileId)
      .maybeSingle();
    if (error) {
      if (isMissingDbObject(error.message, REQUESTS_TABLE)) return true;
      console.error("[generation-commit] readGenerationCancelAllowed DB error:", error.message);
      return false;
    }
    if (!data) return false;
    const row = data as { cancel_allowed?: boolean; status?: string };
    if (row.status === "succeeded" || row.status === "failed") return false;
    return !commitLockedFromCancelAllowed(row.cancel_allowed);
  } catch (e) {
    console.error("[generation-commit] readGenerationCancelAllowed threw:", e);
    return false;
  }
}

/** User-initiated cancel that still warrants a credit refund (before provider commit). */
export async function isRefundableUserCancellation(
  profileId: string,
  generationRequestId: string | null,
  error: unknown,
): Promise<boolean> {
  const isCancelError = isCancellation(error);
  if (!isCancelError) return false;
  if (!generationRequestId) return true;
  const locked = await isProviderCommitLocked(profileId, generationRequestId);
  return isRefundableUserCancellationPure(isCancelError, locked, true);
}
