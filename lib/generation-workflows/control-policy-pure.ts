import type { JobStatus } from "@/lib/jobs-db";

const TERMINAL_JOB_STATUSES = new Set<JobStatus>(["succeeded", "failed", "cancelled"]);

export function isTerminalJobStatus(status: string): status is JobStatus {
  return TERMINAL_JOB_STATUSES.has(status as JobStatus);
}

/** User may request Stop while the job has not reached a terminal state. */
export function canStopGeneration(params: { jobStatus: string }): boolean {
  return !isTerminalJobStatus(params.jobStatus);
}

/** Legacy jobs keep the old cancel gate until stale; workflow jobs can always stop. */
export function canStopGenerationNow(params: {
  jobStatus: string;
  executionBackend: "legacy" | "workflow";
  cancelAllowed: boolean;
  isStale: boolean;
}): boolean {
  if (!canStopGeneration({ jobStatus: params.jobStatus })) return false;
  if (params.jobStatus === "recoverable") return true;
  return (
    params.executionBackend === "workflow" ||
    params.cancelAllowed ||
    params.isStale
  );
}

/**
 * Refund eligibility for workflow-era Stop/cancel settlement.
 * Independent of canStop — post-commit Stop is allowed but not refundable.
 */
export function isRefundEligible(params: {
  providerCommittedAt: string | null | undefined;
  cancelAllowed?: boolean | null;
}): boolean {
  return params.providerCommittedAt == null && params.cancelAllowed !== false;
}

/** Recoverable jobs may resume via existing pipeline-recovery path. */
export function canRetryGeneration(params: { jobStatus: string }): boolean {
  return params.jobStatus === "recoverable";
}

/** Terminal failure/cancel rows may be dismissed from active UI tiles. */
export function canDismissGeneration(params: { jobStatus: string }): boolean {
  return params.jobStatus === "failed" || params.jobStatus === "cancelled";
}

export type GenerationControlSnapshot = {
  canStop: boolean;
  refundEligible: boolean;
  canRetry: boolean;
  canDismiss: boolean;
};

export function generationControlSnapshot(params: {
  jobStatus: string;
  providerCommittedAt: string | null | undefined;
  cancelAllowed?: boolean | null;
}): GenerationControlSnapshot {
  return {
    canStop: canStopGeneration({ jobStatus: params.jobStatus }),
    refundEligible: isRefundEligible({
      providerCommittedAt: params.providerCommittedAt,
      cancelAllowed: params.cancelAllowed,
    }),
    canRetry: canRetryGeneration({ jobStatus: params.jobStatus }),
    canDismiss: canDismissGeneration({ jobStatus: params.jobStatus }),
  };
}
