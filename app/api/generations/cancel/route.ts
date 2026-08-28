import { NextResponse } from "next/server";
import Replicate from "replicate";
import { start } from "workflow/api";
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
import { isTerminalJobStatus } from "@/lib/generation-workflows/control-policy-pure";
import {
  getGenerationRequestForJob,
  requestWorkflowStop,
} from "@/lib/generation-workflows/workflow-db";
import { isLegacyJobForceStoppable } from "@/lib/generation-workflows/stop-settlement-pure";
import {
  generationStopSettlementWorkflow,
  type StopSettlementParams,
} from "@/lib/generation-workflows/stop-settlement";
import type { ExecutionBackend } from "@/lib/generation-workflows/types";

// Cancellation is a fast control-plane call (DB flip + Replicate cancel calls);
// it never waits on a generation. Keep it short.
export const maxDuration = 60;

async function cancelRecordedPredictions(
  profileId: string,
  generationRequestId: string,
): Promise<{ predictions: number; cancelled: number }> {
  let ids: string[] = [];
  try {
    ids = await listPredictionIds(profileId, generationRequestId);
  } catch (e) {
    console.warn("[generations/cancel] listPredictionIds failed:", e);
  }

  let cancelled = 0;
  if (ids.length > 0 && process.env.REPLICATE_API_TOKEN?.trim()) {
    const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
    const res = await cancelReplicatePredictions(replicate, ids);
    cancelled = res.cancelled;
  }
  return { predictions: ids.length, cancelled };
}

async function startStopSettlement(params: StopSettlementParams): Promise<void> {
  await start(generationStopSettlementWorkflow, [params]);
}

async function stopDurableGeneration(params: {
  profileId: string;
  userId: string;
  jobId: string;
  generationRequestId: string;
}) {
  const stopRequest = await requestWorkflowStop({
    profileId: params.profileId,
    jobId: params.jobId,
    generationRequestId: params.generationRequestId,
  });
  if (!stopRequest.accepted) return { accepted: false as const, stopRequest };

  const predictions = await cancelRecordedPredictions(
    params.profileId,
    params.generationRequestId,
  );
  await startStopSettlement({
    profileId: params.profileId,
    jobId: params.jobId,
    userId: params.userId,
  });
  return {
    accepted: true as const,
    refundEligible: stopRequest.refundEligible,
    predictions,
  };
}

/**
 * POST /api/generations/cancel
 *
 * Cancel an in-flight generation or abandon a recoverable job.
 *
 * Body: `{ idempotencyKey: string }` — cancel in-flight attempt (same as generate).
 * Body: `{ jobId: string }` — abandon recoverable job, workflow Stop, or stale legacy force-stop.
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

      if (job.status === "recoverable") {
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
        return NextResponse.json({ status: "abandoned", refunded: false });
      }

      if (isTerminalJobStatus(job.status)) {
        return NextResponse.json(
          { error: "Job is not active.", status: job.status },
          { status: 409 },
        );
      }

      const executionBackend = (job.execution_backend ?? "legacy") as ExecutionBackend;
      const isWorkflowJob = executionBackend === "workflow";

      if (!isWorkflowJob && !isLegacyJobForceStoppable(job.updated_at)) {
        return NextResponse.json(
          {
            code: "USE_IDEMPOTENCY_CANCEL",
            message:
              "This generation is still in progress. Use Cancel in the tool while it is running, or wait until it becomes stale.",
            cancelAllowed: true,
          },
          { status: 409 },
        );
      }

      const genReq = await getGenerationRequestForJob(profileId, jobId);
      if (!genReq) {
        return NextResponse.json(
          { error: "No generation request linked to this job." },
          { status: 404 },
        );
      }

      const stop = await stopDurableGeneration({
        profileId,
        userId: authUserId,
        jobId,
        generationRequestId: genReq.id,
      });
      if (!stop.accepted) {
        return NextResponse.json(
          {
            error: "Job is no longer active.",
            code: "JOB_NOT_ACTIVE",
            status: stop.stopRequest.status ?? job.status,
          },
          { status: 409 },
        );
      }

      return NextResponse.json(
        {
          status: "stopping",
          refundEligible: stop.refundEligible,
          predictions: stop.predictions.predictions,
          cancelled: stop.predictions.cancelled,
        },
        { status: 202 },
      );
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
          return NextResponse.json({ status: "abandoned", refunded: false });
        }
      }
      return NextResponse.json({ status: "already_failed" });
    }

    const linkedJob = existing.job_id ? await getJob(profileId, existing.job_id) : null;
    if (linkedJob && (linkedJob.execution_backend ?? "legacy") === "workflow") {
      if (isTerminalJobStatus(linkedJob.status)) {
        return NextResponse.json(
          { error: "Job is not active.", status: linkedJob.status },
          { status: 409 },
        );
      }

      const stop = await stopDurableGeneration({
        profileId,
        userId: authUserId,
        jobId: linkedJob.id,
        generationRequestId: existing.id,
      });
      if (!stop.accepted) {
        return NextResponse.json(
          {
            error: "Job is no longer active.",
            code: "JOB_NOT_ACTIVE",
            status: stop.stopRequest.status ?? linkedJob.status,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(
        {
          status: "stopping",
          refundEligible: stop.refundEligible,
          predictions: stop.predictions.predictions,
          cancelled: stop.predictions.cancelled,
        },
        { status: 202 },
      );
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

    const predictionResult = await cancelRecordedPredictions(profileId, existing.id);

    return NextResponse.json({
      status: "cancelling",
      predictions: predictionResult.predictions,
      cancelled: predictionResult.cancelled,
    });
  } catch (error: unknown) {
    console.error("[generations/cancel] Error:", error);
    return NextResponse.json({ error: "Failed to cancel generation." }, { status: 500 });
  }
}
