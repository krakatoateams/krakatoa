import { sleep } from "workflow";
import { resolveSubmissionFenceDecision, type SubmissionFenceSnapshot } from "./submission-fence-pure";
import {
  ProviderSubmissionStateUnknownError,
  shouldRefundOnUnknownSubmissionTimeout,
  shouldRunSubmissionListRecovery,
  unknownSubmissionTimeoutErrorJson,
  SUBMISSION_FENCE_POLL_SLEEP_MS,
} from "./submission-recovery-pure";
import type { MotionControlSuccessResponse } from "@/lib/motion-control-finalize";
import {
  isWorkflowStoppedError,
  workflowStoppedMessage,
  MOTION_CONTROL_MAX_POLL_ITERATIONS,
  MOTION_CONTROL_POLL_SLEEP_MS,
  type MotionControlWorkflowParams,
} from "./motion-control-workflow-types";

export async function motionControlGenerationWorkflow(
  params: MotionControlWorkflowParams,
): Promise<MotionControlSuccessResponse | null> {
  "use workflow";

  console.log("[motion-control workflow] start", params.jobId);

  let stepId: string | null = null;
  try {
    stepId = await beginMotionControlStep(params);
    const prediction = await ensurePredictionIdWorkflow(params);
    const outputUrl = await pollUntilTerminal(
      params,
      prediction.submissionId,
      prediction.predictionId,
    );
    const result = await deliverAndFinalizeStep(params, outputUrl);
    await endMotionControlStep(params.profileId, stepId, { storagePath: result.storagePath });
    await cleanupTempRefsStep(params.tempRefPaths);
    console.log("[motion-control workflow] succeeded", params.jobId);
    return result;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[motion-control workflow] failed", params.jobId, message);
    const stopped = isWorkflowStoppedError(error);
    if (stopped) {
      console.log("[motion-control workflow] stop detected — settling", params.jobId);
      await settleStoppedWorkflowStep(params);
      await cleanupTempRefsStep(params.tempRefPaths);
      return null;
    }
    const unknownSubmission = error instanceof ProviderSubmissionStateUnknownError;
    const errJson = unknownSubmission
      ? unknownSubmissionTimeoutErrorJson()
      : { message };
    await failMotionControlStep(params, stepId, errJson);
    await failWorkflowAttemptStep(params, errJson, {
      refund: unknownSubmission ? shouldRefundOnUnknownSubmissionTimeout() : true,
    });
    await cleanupTempRefsStep(params.tempRefPaths);
    return null;
  }
}

async function settleStoppedWorkflowStep(params: MotionControlWorkflowParams): Promise<void> {
  "use step";
  const { settleGenerationStop } = await import("./stop-settlement-core");
  await settleGenerationStop({
    profileId: params.profileId,
    userId: params.userId,
    jobId: params.jobId,
  });
}

async function beginMotionControlStep(params: MotionControlWorkflowParams): Promise<string | null> {
  "use step";
  const { beginMotionControlStepCore } = await import("./motion-control-workflow-core");
  return beginMotionControlStepCore(params);
}

async function endMotionControlStep(
  profileId: string,
  stepId: string | null,
  output?: Record<string, unknown>,
): Promise<void> {
  "use step";
  const { endMotionControlStepCore } = await import("./motion-control-workflow-core");
  await endMotionControlStepCore(profileId, stepId, output);
}

async function failMotionControlStep(
  params: MotionControlWorkflowParams,
  stepId: string | null,
  errJson: Record<string, unknown>,
): Promise<void> {
  "use step";
  const { failMotionControlStepCore } = await import("./motion-control-workflow-core");
  await failMotionControlStepCore(params, stepId, errJson);
}

async function ensurePredictionIdWorkflow(
  params: MotionControlWorkflowParams,
): Promise<{ submissionId: string; predictionId: string }> {
  "use workflow";

  let submissionId: string | null = null;
  let fenceWaitLoops = 0;

  while (true) {
    const snapshot: SubmissionFenceSnapshot | null = submissionId
      ? await loadSubmissionSnapshotStep(params, submissionId)
      : await reserveSubmissionStep(params);
    if (!snapshot) throw new Error("Submission fence disappeared while waiting.");
    submissionId = snapshot.submissionId;

    const decision = resolveSubmissionFenceDecision(snapshot);

    if (decision.kind === "submit") {
      const submitResult = await submitNewPredictionStep(params, decision.submissionId);
      if (submitResult.outcome === "prediction") {
        return {
          submissionId: decision.submissionId,
          predictionId: submitResult.predictionId,
        };
      }
      await sleep(SUBMISSION_FENCE_POLL_SLEEP_MS);
      continue;
    }
    if (decision.kind === "reuse") {
      return { submissionId: decision.submissionId, predictionId: decision.predictionId };
    }
    if (decision.kind === "terminal_failed") {
      throw new Error(
        typeof decision.errorJson?.message === "string"
          ? decision.errorJson.message
          : "Provider submission failed.",
      );
    }
    if (decision.kind === "timed_out") {
      const concurrentPredictionId = await markSubmissionUnknownTimeoutStep(
        params,
        decision.submissionId,
      );
      if (concurrentPredictionId) {
        return {
          submissionId: decision.submissionId,
          predictionId: concurrentPredictionId,
        };
      }
      throw new ProviderSubmissionStateUnknownError();
    }
    if (decision.kind === "wait") {
      fenceWaitLoops++;
      if (
        decision.reason === "pending_submission" &&
        shouldRunSubmissionListRecovery(fenceWaitLoops)
      ) {
        await touchHeartbeatStep(params);
        const recovered = await recoverPredictionFromListStep(params, submissionId);
        if (recovered) return { submissionId, predictionId: recovered };
      }
      await sleep(SUBMISSION_FENCE_POLL_SLEEP_MS);
      continue;
    }

    throw new Error("Unhandled submission fence decision.");
  }
}

async function reserveSubmissionStep(params: MotionControlWorkflowParams) {
  "use step";
  const { reserveSubmissionCore } = await import("./motion-control-workflow-core");
  return reserveSubmissionCore(params);
}

async function loadSubmissionSnapshotStep(
  params: MotionControlWorkflowParams,
  submissionId: string,
) {
  "use step";
  const { loadSubmissionSnapshotCore } = await import("./motion-control-workflow-core");
  return loadSubmissionSnapshotCore(params, submissionId);
}

async function markSubmissionUnknownTimeoutStep(
  params: MotionControlWorkflowParams,
  submissionId: string,
): Promise<string | null> {
  "use step";
  const { markSubmissionUnknownTimeoutCore } = await import("./motion-control-workflow-core");
  return markSubmissionUnknownTimeoutCore(params, submissionId);
}

async function recoverPredictionFromListStep(
  params: MotionControlWorkflowParams,
  submissionId: string,
): Promise<string | null> {
  "use step";
  const { recoverPredictionFromListCore } = await import("./motion-control-workflow-core");
  return recoverPredictionFromListCore(params, submissionId);
}

async function submitNewPredictionStep(
  params: MotionControlWorkflowParams,
  submissionId: string,
) {
  "use step";
  const { submitNewPredictionCore } = await import("./motion-control-workflow-core");
  return submitNewPredictionCore(params, submissionId);
}

async function pollUntilTerminal(
  params: MotionControlWorkflowParams,
  submissionId: string,
  predictionId: string,
): Promise<string> {
  "use workflow";

  for (let i = 0; i < MOTION_CONTROL_MAX_POLL_ITERATIONS; i++) {
    const stopped = await isWorkflowStopRequestedStep(params);
    if (stopped) {
      throw new Error(workflowStoppedMessage());
    }

    const poll = await pollReplicateOnceStep(params, submissionId, predictionId);
    await touchHeartbeatStep(params);

    if (!poll.terminal) {
      await sleep(MOTION_CONTROL_POLL_SLEEP_MS);
      continue;
    }

    if (poll.outcome === "success") {
      return poll.outputUrl;
    }

    if (poll.outcome === "cancelled") {
      throw new Error(poll.message);
    }

    throw new Error(poll.message);
  }

  throw new Error("Motion control generation timed out while polling provider.");
}

async function isWorkflowStopRequestedStep(params: MotionControlWorkflowParams): Promise<boolean> {
  "use step";
  const { isWorkflowStopRequestedCore } = await import("./motion-control-workflow-core");
  return isWorkflowStopRequestedCore(params);
}

async function pollReplicateOnceStep(
  params: MotionControlWorkflowParams,
  submissionId: string,
  predictionId: string,
) {
  "use step";
  const { pollReplicateOnceCore } = await import("./motion-control-workflow-core");
  return pollReplicateOnceCore(params, submissionId, predictionId);
}

async function touchHeartbeatStep(params: MotionControlWorkflowParams): Promise<void> {
  "use step";
  const { touchHeartbeatCore } = await import("./motion-control-workflow-core");
  await touchHeartbeatCore(params);
}

async function deliverAndFinalizeStep(
  params: MotionControlWorkflowParams,
  generatedVideoUrl: string,
): Promise<MotionControlSuccessResponse> {
  "use step";
  const { deliverAndFinalizeCore } = await import("./motion-control-workflow-core");
  return deliverAndFinalizeCore(params, generatedVideoUrl);
}

async function failWorkflowAttemptStep(
  params: MotionControlWorkflowParams,
  errJson: Record<string, unknown>,
  options: { refund?: boolean } = {},
): Promise<void> {
  "use step";
  const { settleWorkflowFailure } = await import("./stop-settlement-core");
  await settleWorkflowFailure({
    profileId: params.profileId,
    userId: params.userId,
    jobId: params.jobId,
    generationRequestId: params.generationRequestId,
    errorJson: errJson,
    refund: options.refund !== false,
  });
}

async function cleanupTempRefsStep(paths: string[]): Promise<void> {
  "use step";
  const { cleanupTempRefsCore } = await import("./motion-control-workflow-core");
  await cleanupTempRefsCore(paths);
}
