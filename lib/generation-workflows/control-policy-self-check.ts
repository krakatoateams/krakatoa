import { METERED_JOB_TYPES } from "./metered-job-types";
import {
  isWorkflowEnabledForJobType,
  resolveExecutionBackendForJobType,
  workflowFlagSnapshot,
} from "./feature-flags";
import {
  canDismissGeneration,
  canRetryGeneration,
  canStopGeneration,
  canStopGenerationNow,
  generationControlSnapshot,
  isRefundEligible,
  isTerminalJobStatus,
} from "./control-policy-pure";
import { stopSettlementSelfCheck } from "./stop-settlement-self-check";
import { submissionFenceSelfCheck } from "./submission-fence-self-check";
import { webhookTokenSelfCheck } from "./webhook-token-self-check";
import { pollingSelfCheck } from "./polling-self-check";
import { finalizationSelfCheck } from "./finalization-self-check";

/** ponytail: runnable without Supabase — fails if control/flag contracts break. */
export function generationWorkflowsSelfCheck(): void {
  const configuredFlags = process.env.GENERATION_WORKFLOW_ENABLED_JOB_TYPES;
  delete process.env.GENERATION_WORKFLOW_ENABLED_JOB_TYPES;
  try {
    for (const jobType of METERED_JOB_TYPES) {
      if (isWorkflowEnabledForJobType(jobType)) {
        throw new Error(`workflow must default off for ${jobType}`);
      }
      if (resolveExecutionBackendForJobType(jobType) !== "legacy") {
        throw new Error(`default execution backend must be legacy for ${jobType}`);
      }
    }

    const snapshot = workflowFlagSnapshot();
    if (Object.keys(snapshot).length !== METERED_JOB_TYPES.length) {
      throw new Error("workflowFlagSnapshot must cover every metered job type");
    }

    process.env.GENERATION_WORKFLOW_ENABLED_JOB_TYPES = "video_motion_control";
    if (resolveExecutionBackendForJobType("video_motion_control") !== "workflow") {
      throw new Error("enabled motion control must route to workflow backend");
    }
    if (resolveExecutionBackendForJobType("reels_seedance") !== "legacy") {
      throw new Error("non-enabled job types must stay legacy when motion control is enabled");
    }
  } finally {
    if (configuredFlags === undefined) {
      delete process.env.GENERATION_WORKFLOW_ENABLED_JOB_TYPES;
    } else {
      process.env.GENERATION_WORKFLOW_ENABLED_JOB_TYPES = configuredFlags;
    }
  }

  if (!canStopGeneration({ jobStatus: "running" })) {
    throw new Error("running job must be stoppable");
  }
  if (canStopGeneration({ jobStatus: "succeeded" })) {
    throw new Error("succeeded job must not be stoppable");
  }
  if (canStopGenerationNow({
    jobStatus: "running",
    executionBackend: "legacy",
    cancelAllowed: false,
    isStale: false,
  })) {
    throw new Error("fresh commit-locked legacy job must not expose a stop that will fail");
  }
  if (!canStopGenerationNow({
    jobStatus: "running",
    executionBackend: "workflow",
    cancelAllowed: false,
    isStale: false,
  })) {
    throw new Error("workflow job must remain stoppable after provider commit");
  }
  if (!isTerminalJobStatus("cancelled")) {
    throw new Error("cancelled must be terminal");
  }

  if (!isRefundEligible({ providerCommittedAt: null })) {
    throw new Error("pre-commit must be refund eligible");
  }
  if (isRefundEligible({ providerCommittedAt: "2026-01-01T00:00:00.000Z" })) {
    throw new Error("post-commit must not be refund eligible");
  }
  if (isRefundEligible({ providerCommittedAt: null, cancelAllowed: false })) {
    throw new Error("legacy cancel lock must not be refund eligible");
  }

  if (!canRetryGeneration({ jobStatus: "recoverable" })) {
    throw new Error("recoverable job must allow retry");
  }
  if (canRetryGeneration({ jobStatus: "running" })) {
    throw new Error("running job must not expose retry");
  }

  if (!canDismissGeneration({ jobStatus: "failed" })) {
    throw new Error("failed job must be dismissible");
  }
  if (canDismissGeneration({ jobStatus: "running" })) {
    throw new Error("running job must not be dismissible");
  }

  const postCommitStop = generationControlSnapshot({
    jobStatus: "running",
    providerCommittedAt: "2026-01-01T00:00:00.000Z",
  });
  if (!postCommitStop.canStop || postCommitStop.refundEligible) {
    throw new Error("post-commit running job: canStop without refund");
  }

  const preCommitStop = generationControlSnapshot({
    jobStatus: "running",
    providerCommittedAt: null,
  });
  if (!preCommitStop.canStop || !preCommitStop.refundEligible) {
    throw new Error("pre-commit running job: canStop with refund");
  }

  stopSettlementSelfCheck();
  submissionFenceSelfCheck();
  webhookTokenSelfCheck();
  pollingSelfCheck();
  finalizationSelfCheck();
}

if (process.argv[1]?.includes("control-policy-self-check")) {
  generationWorkflowsSelfCheck();
  console.log("generation-workflows self-check ok");
}
