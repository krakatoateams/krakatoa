import { NextResponse } from "next/server";
import Replicate from "replicate";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { getJob } from "@/lib/jobs-db";
import {
  getExistingGenerationRequest,
  finishGenerationRequestsForJob,
  isPipelineRecoverableErrorJson,
} from "@/lib/generation-idempotency";
import { isProviderCommitLocked } from "@/lib/generation-commit";
import { commitLockedFromCancelAllowed } from "@/lib/generation-commit-pure";
import {
  requestCancel,
  listPredictionIds,
  cancelReplicatePredictions,
} from "@/lib/generation-cancel";
import {
  abandonRecoverableJob,
  userIdFromJob,
} from "@/lib/pipeline-recovery/failure";

// Cancellation is a fast control-plane call (DB flip + Replicate cancel calls);
// it never waits on a generation. Keep it short.
export const maxDuration = 60;

/**
 * POST /api/generations/cancel
 *
 * Cancel an in-flight generation or abandon a recoverable job.
 *
 * Body: `{ idempotencyKey: string }` — cancel in-flight attempt (same as generate).
 * Body: `{ jobId: string }` — abandon recoverable job, purge storage, refund credits.
 */
export async function POST(req: Request) {
  let profileId: string;
  let authUserId: string;
  try {
    try {
      const profile = await requireCurrentProfile();
      profileId = profile.id;
      authUserId = profile.user_id;
    } catch (e) {
      if (e instanceof Error && /not authenticated/i.test(e.message)) {
        return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
      }
      console.error("[generations/cancel] profile resolution failed (non-auth):", e);
      return NextResponse.json(
        { error: "Profile resolution failed. Please try again." },
        { status: 500 },
      );
    }

    const body = await req.json().catch(() => null);
    const jobId = body && typeof body.jobId === "string" ? body.jobId.trim() : "";

    if (jobId) {
      const job = await getJob(profileId, jobId);
      if (!job) {
        return NextResponse.json({ error: "Job not found." }, { status: 404 });
      }
      if (job.status !== "recoverable") {
        return NextResponse.json(
          { error: "Job is not recoverable.", status: job.status },
          { status: 409 },
        );
      }
      const userId = userIdFromJob(job, authUserId);
      if (!userId) {
        return NextResponse.json({ error: "Could not resolve user for job." }, { status: 500 });
      }
      await abandonRecoverableJob({
        profileId,
        userId,
        jobId,
        jobType: job.job_type,
        creditsAmount: job.cost_credits,
        reason: "Recovery abandoned by user.",
      });
      await finishGenerationRequestsForJob({
        profileId,
        jobId,
        errorJson: {
          code: "GENERATION_ABANDONED",
          message: "Recovery abandoned by user.",
        },
      });
      return NextResponse.json({ status: "abandoned", refunded: true });
    }

    const idempotencyKey =
      body && typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "idempotencyKey or jobId is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 },
      );
    }

    const existing = await getExistingGenerationRequest(profileId, idempotencyKey);
    if (!existing) {
      return NextResponse.json({ status: "not_found" }, { status: 404 });
    }

    if (existing.status === "succeeded") {
      return NextResponse.json({ status: "already_completed" });
    }

    if (existing.status === "failed") {
      if (
        isPipelineRecoverableErrorJson(existing.error_json as Record<string, unknown>) &&
        existing.job_id
      ) {
        const job = await getJob(profileId, existing.job_id);
        if (job?.status === "recoverable") {
          const userId = userIdFromJob(job, authUserId);
          if (!userId) {
            return NextResponse.json({ error: "Could not resolve user for job." }, { status: 500 });
          }
          await abandonRecoverableJob({
            profileId,
            userId,
            jobId: existing.job_id,
            jobType: job.job_type,
            creditsAmount: job.cost_credits,
            reason: "Recovery abandoned by user.",
          });
          await finishGenerationRequestsForJob({
            profileId,
            jobId: existing.job_id,
            errorJson: {
              code: "GENERATION_ABANDONED",
              message: "Recovery abandoned by user.",
            },
          });
          return NextResponse.json({ status: "abandoned", refunded: true });
        }
      }
      return NextResponse.json({ status: "already_failed" });
    }

    if (existing.cancel_requested) {
      return NextResponse.json({ status: "already_cancelling" });
    }

    if (commitLockedFromCancelAllowed(existing.cancel_allowed)) {
      return NextResponse.json(
        {
          code: "CANCEL_NOT_ALLOWED",
          message: "Generation can no longer be cancelled.",
          cancelAllowed: false,
        },
        { status: 409 },
      );
    }

    if (await isProviderCommitLocked(profileId, existing.id)) {
      return NextResponse.json(
        {
          code: "CANCEL_NOT_ALLOWED",
          message: "Generation can no longer be cancelled.",
          cancelAllowed: false,
        },
        { status: 409 },
      );
    }

    const cancelAccepted = await requestCancel(profileId, existing.id);
    if (!cancelAccepted) {
      if (await isProviderCommitLocked(profileId, existing.id)) {
        return NextResponse.json(
          {
            code: "CANCEL_NOT_ALLOWED",
            message: "Generation can no longer be cancelled.",
            cancelAllowed: false,
          },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: "Generation not found." }, { status: 404 });
    }

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
