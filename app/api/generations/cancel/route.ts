import { NextResponse } from "next/server";
import Replicate from "replicate";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { getExistingGenerationRequest } from "@/lib/generation-idempotency";
import {
  requestCancel,
  listPredictionIds,
  cancelReplicatePredictions,
} from "@/lib/generation-cancel";

// Cancellation is a fast control-plane call (DB flip + Replicate cancel calls);
// it never waits on a generation. Keep it short.
export const maxDuration = 60;

/**
 * POST /api/generations/cancel
 *
 * Cancel an in-flight generation. The client passes the same Idempotency-Key it
 * used for the original generate request (its handle on the attempt). We:
 *   1. Resolve the row by (profile_id, idempotencyKey) — ownership enforced.
 *   2. Short-circuit if the attempt already finished (succeeded/failed).
 *   3. Flip generation_requests.cancel_requested = true.
 *   4. Cancel every recorded Replicate prediction for the attempt.
 *
 * The still-running generate request detects the cancellation (its provider poll
 * loop sees status `canceled`), marks the job 'cancelled', and refunds. This
 * endpoint never refunds or finalizes the job itself — that keeps a single owner
 * of the refund and avoids double-refund races.
 *
 * Body: { idempotencyKey: string }
 */
export async function POST(req: Request) {
  let profileId: string;
  try {
    try {
      const profile = await requireCurrentProfile();
      profileId = profile.id;
    } catch (e) {
      if (e instanceof Error && /not authenticated/i.test(e.message)) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
      console.error("[generations/cancel] profile resolution failed (non-auth):", e);
      return NextResponse.json(
        { error: "Profile resolution failed. Please try again." },
        { status: 500 }
      );
    }

    const body = await req.json().catch(() => null);
    const idempotencyKey =
      body && typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "idempotencyKey is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 }
      );
    }

    const existing = await getExistingGenerationRequest(profileId, idempotencyKey);
    if (!existing) {
      // No attempt under this key (yet). Nothing to cancel.
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }

    // Already terminal — nothing to stop.
    if (existing.status === "succeeded") {
      return NextResponse.json({ status: "already_completed" });
    }
    if (existing.status === "failed") {
      return NextResponse.json({ status: "already_failed" });
    }

    // Flag it cancelled (so any not-yet-created provider step aborts early), then
    // stop every Replicate prediction we've recorded for this attempt.
    await requestCancel(profileId, existing.id);

    let ids: string[] = [];
    try {
      ids = await listPredictionIds(profileId, existing.id);
    } catch (e) {
      console.warn("[generations/cancel] listPredictionIds failed:", e);
    }

    let cancelled = 0;
    if (ids.length > 0 && process.env.REPLICATE_API_TOKEN?.trim()) {
      const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
      const res = await cancelReplicatePredictions(replicate, ids);
      cancelled = res.cancelled;
    }

    return NextResponse.json({
      status: "cancelling",
      predictions: ids.length,
      cancelled,
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    console.error("[generations/cancel] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
