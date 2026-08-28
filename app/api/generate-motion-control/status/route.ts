import { NextResponse } from "next/server";
import { createReplicateClient } from "@/lib/replicate-utils";
import { extractMediaUrl } from "@/lib/replicate-server";
import { isCancellation } from "@/lib/replicate-server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import {
  readIdempotencyKey,
  isValidIdempotencyKey,
  getExistingGenerationRequest,
} from "@/lib/generation-idempotency";
import { listPredictionIds } from "@/lib/generation-cancel";
import { isCancelRequested } from "@/lib/generation-cancel";
import {
  markProviderCommitted,
  readGenerationCancelAllowed,
  isProviderCommitLocked,
  isRefundableUserCancellation,
} from "@/lib/generation-commit";
import {
  buildMotionControlFinalizeContext,
  type MotionControlJobInput,
} from "@/lib/motion-control-context";
import {
  finalizeMotionControlSuccess,
  failMotionControlAttempt,
  endMotionControlStep,
  type MotionControlFinalizeContext,
} from "@/lib/motion-control-finalize";
import { supabaseServer } from "@/lib/supabase-server";
import type { Job } from "@/lib/jobs-db";

export const dynamic = "force-dynamic";

const PROCESSING = { status: "processing" as const };

async function processingPayload(profileId: string, generationRequestId: string) {
  const cancelAllowed = await readGenerationCancelAllowed(profileId, generationRequestId);
  return { ...PROCESSING, cancelAllowed };
}

export async function GET(req: Request) {
  let currentStepId: string | null = null;
  let motionCtx: MotionControlFinalizeContext | null = null;

  try {
    const profile = await requireCurrentProfile();
    const profileId = profile.id;
    const userId = profile.user_id;

    const idemKey = readIdempotencyKey(req);
    if (!isValidIdempotencyKey(idemKey)) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required.", code: "IDEMPOTENCY_KEY_REQUIRED" },
        { status: 400 },
      );
    }

    const generationRequest = await getExistingGenerationRequest(profileId, idemKey);
    if (!generationRequest) {
      return NextResponse.json({ error: "Generation not found." }, { status: 404 });
    }

    if (generationRequest.status === "succeeded" && generationRequest.response_json) {
      return NextResponse.json(generationRequest.response_json);
    }
    if (generationRequest.status === "failed") {
      const err = (generationRequest.error_json ?? { message: "Generation failed." }) as {
        message?: string;
        code?: string;
      };
      if (err.code === "GENERATION_CANCELLED") {
        const failedJobId =
          generationRequest.job_id ?? (await lookupJobId(profileId, generationRequest.id));
        const failedJob = failedJobId ? await loadJob(profileId, failedJobId) : null;
        const failedInput = (failedJob?.input ?? {}) as MotionControlJobInput;
        const failedCredits =
          failedInput.creditsAmount ?? failedJob?.cost_credits ?? 0;
        const refunded =
          failedJob?.execution_backend === "workflow"
            ? await hasSuccessfulRefund(profileId, failedJob.id)
            : failedCredits > 0;
        return NextResponse.json(
          {
            error: err.message ?? "Generation cancelled.",
            code: "GENERATION_CANCELLED",
            refunded,
          },
          { status: 409 },
        );
      }
      return NextResponse.json(err, { status: 500 });
    }

    const jobIdEarly =
      generationRequest.job_id ?? (await lookupJobId(profileId, generationRequest.id));
    const jobEarly = jobIdEarly ? await loadJob(profileId, jobIdEarly) : null;
    if (jobEarly?.execution_backend === "workflow") {
      return NextResponse.json(await processingPayload(profileId, generationRequest.id), {
        status: 202,
      });
    }

    const predictionIds = await listPredictionIds(profileId, generationRequest.id);
    if (predictionIds.length === 0) {
      return NextResponse.json(await processingPayload(profileId, generationRequest.id), {
        status: 202,
      });
    }

    const jobId = generationRequest.job_id ?? (await lookupJobId(profileId, generationRequest.id));
    const job = jobId ? await loadJob(profileId, jobId) : null;
    const jobInput = (job?.input ?? {}) as MotionControlJobInput;
    const videoAssetId = generationRequest.asset_id ?? jobInput.videoAssetId ?? null;
    const creditsAmount = jobInput.creditsAmount ?? job?.cost_credits ?? 0;

    const ctx = buildMotionControlFinalizeContext({
      profileId,
      userId,
      jobId,
      videoAssetId,
      generationRequestId: generationRequest.id,
      creditsAmount,
      prompt: jobInput.prompt ?? "",
      jobInput,
    });

    motionCtx = ctx;

    const replicate = createReplicateClient();
    const predictionId = predictionIds[predictionIds.length - 1]!;
    const prediction = await replicate.predictions.get(predictionId);
    const predictionSucceeded = prediction.status === "succeeded";

    if (
      !predictionSucceeded &&
      (await isCancelRequested(profileId, generationRequest.id)) &&
      !(await isProviderCommitLocked(profileId, generationRequest.id))
    ) {
      if (prediction.status === "starting" || prediction.status === "processing") {
        try {
          await replicate.predictions.cancel(predictionId);
        } catch {
          /* best-effort */
        }
        return NextResponse.json(await processingPayload(profileId, generationRequest.id), {
          status: 202,
        });
      }
      const errJson = { message: "Generation cancelled.", code: "GENERATION_CANCELLED" };
      await failMotionControlAttempt(ctx, errJson, { cancelled: true });
      return NextResponse.json(
        {
          error: "Generation cancelled.",
          code: "GENERATION_CANCELLED",
          refunded: creditsAmount > 0,
        },
        { status: 409 },
      );
    }

    if (prediction.status === "starting" || prediction.status === "processing") {
      return NextResponse.json(await processingPayload(profileId, generationRequest.id), {
        status: 202,
      });
    }

    if (prediction.status === "canceled" || prediction.status === "aborted") {
      const errJson = { message: "Generation cancelled.", code: "GENERATION_CANCELLED" };
      const lockedNow = await isProviderCommitLocked(profileId, generationRequest.id);
      const refundable = !lockedNow;
      await failMotionControlAttempt(ctx, errJson, {
        cancelled: true,
        refund: refundable,
      });
      return NextResponse.json(
        {
          error: "Generation cancelled.",
          code: "GENERATION_CANCELLED",
          refunded: refundable && creditsAmount > 0,
        },
        { status: 409 },
      );
    }

    if (prediction.status === "failed") {
      const message =
        typeof prediction.error === "string"
          ? prediction.error
          : prediction.error
            ? JSON.stringify(prediction.error)
            : "Motion control generation failed.";
      const errJson = { message };
      await failMotionControlAttempt(ctx, errJson);
      return NextResponse.json({ error: "Motion control generation failed." }, { status: 500 });
    }

    if (prediction.status !== "succeeded") {
      return NextResponse.json(await processingPayload(profileId, generationRequest.id), {
        status: 202,
      });
    }

    const generatedVideoUrl = extractMediaUrl(prediction.output);
    if (!generatedVideoUrl.startsWith("http")) {
      const errJson = { message: "Motion control model did not return a valid video URL" };
      await failMotionControlAttempt(ctx, errJson);
      return NextResponse.json({ error: errJson.message }, { status: 500 });
    }

    const { data: runningStep } = await supabaseServer
      .from("job_steps")
      .select("id")
      .eq("job_id", jobId ?? "")
      .eq("profile_id", profileId)
      .eq("step_key", "motion_control_generation")
      .eq("status", "running")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    currentStepId = runningStep?.id ?? null;
    await endMotionControlStep(profileId, currentStepId, { generatedVideoUrl });
    currentStepId = null;

    await markProviderCommitted({
      generationRequestId: generationRequest.id,
      profileId,
      reason: "motion_control_generation",
    });

    const successResponse = await finalizeMotionControlSuccess(ctx, generatedVideoUrl);
    return NextResponse.json(successResponse);
  } catch (error: unknown) {
    if (error instanceof Error && /not authenticated/i.test(error.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    if (isCancellation(error)) {
      const errJson = { message: "Generation cancelled.", code: "GENERATION_CANCELLED" };
      const refundable =
        motionCtx?.generationRequestId
          ? await isRefundableUserCancellation(
              motionCtx.profileId,
              motionCtx.generationRequestId,
              error,
            )
          : true;
      if (motionCtx) {
        await failMotionControlAttempt(motionCtx, errJson, {
          cancelled: true,
          refund: refundable,
        });
      }
      return NextResponse.json(
        {
          error: "Generation cancelled.",
          code: "GENERATION_CANCELLED",
          refunded: refundable && motionCtx ? motionCtx.creditsAmount > 0 : false,
        },
        { status: 409 },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[motion-control status] Error:", error);
    if (motionCtx) {
      const errJson = { message };
      await failMotionControlAttempt(motionCtx, errJson, { refund: true });
    }
    return NextResponse.json({ error: "Motion control generation failed." }, { status: 500 });
  }
}

async function hasSuccessfulRefund(profileId: string, jobId: string): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("credit_transactions")
    .select("id")
    .eq("profile_id", profileId)
    .eq("job_id", jobId)
    .eq("type", "refund")
    .eq("status", "succeeded")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`Failed to read generation refund: ${error.message}`);
  return !!data;
}

async function lookupJobId(profileId: string, generationRequestId: string): Promise<string | null> {
  const { data } = await supabaseServer
    .from("generation_predictions")
    .select("job_id")
    .eq("generation_request_id", generationRequestId)
    .eq("profile_id", profileId)
    .not("job_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { job_id?: string } | null)?.job_id ?? null;
}

async function loadJob(profileId: string, jobId: string): Promise<Job | null> {
  const { data } = await supabaseServer
    .from("jobs")
    .select("*")
    .eq("id", jobId)
    .eq("profile_id", profileId)
    .maybeSingle();
  return (data as Job | null) ?? null;
}
