import type { ExecutionBackend } from "./types";

type SettleWorkflowFailure = typeof import("./stop-settlement-core")["settleWorkflowFailure"];
type WorkflowFailureParams = Parameters<SettleWorkflowFailure>[0];

export type MotionControlRouteFailureResult<T> =
  | { kind: "workflow_settled" }
  | { kind: "workflow_settlement_pending"; error: unknown }
  | { kind: "workflow_start_ambiguous" }
  | { kind: "legacy"; result: T };

export type MotionControlRouteFailureHttp = {
  status: 202 | 500;
  body: {
    status?: "processing";
    error?: string;
    code:
      | "WORKFLOW_START_FAILED"
      | "WORKFLOW_SETTLEMENT_PENDING"
      | "WORKFLOW_START_STATE_UNKNOWN";
    jobId: string;
    settled?: true;
  };
};

type SharedFailureInput<T> = {
  finishLegacy: () => Promise<T>;
};

type MotionControlRouteFailureInput<T> =
  | (SharedFailureInput<T> & {
      executionBackend: Extract<ExecutionBackend, "legacy">;
    })
  | (SharedFailureInput<T> & {
      executionBackend: Extract<ExecutionBackend, "workflow">;
      workflowStartAttempted: boolean;
      workflowFailure: WorkflowFailureParams;
    });

type MotionControlRouteFailureOps = {
  settleWorkflowFailure: SettleWorkflowFailure;
};

const defaultOps: MotionControlRouteFailureOps = {
  settleWorkflowFailure: async (params) => {
    const { settleWorkflowFailure } = await import("./stop-settlement-core");
    await settleWorkflowFailure(params);
  },
};

export async function settleMotionControlRouteFailure<T>(
  input: MotionControlRouteFailureInput<T>,
  ops: MotionControlRouteFailureOps = defaultOps,
): Promise<MotionControlRouteFailureResult<T>> {
  if (input.executionBackend === "legacy") {
    return { kind: "legacy", result: await input.finishLegacy() };
  }
  if (!input.workflowStartAttempted) {
    try {
      await ops.settleWorkflowFailure(input.workflowFailure);
      return { kind: "workflow_settled" };
    } catch (error) {
      return { kind: "workflow_settlement_pending", error };
    }
  }

  return { kind: "workflow_start_ambiguous" };
}

export function resolveMotionControlRouteFailureHttp(
  result: MotionControlRouteFailureResult<unknown>,
  jobId: string,
): MotionControlRouteFailureHttp {
  switch (result.kind) {
    case "workflow_settled":
      return {
        status: 500,
        body: {
          error: "Motion control workflow could not be started. Please try again.",
          code: "WORKFLOW_START_FAILED",
          jobId,
          settled: true,
        },
      };
    case "workflow_settlement_pending":
      return {
        status: 202,
        body: {
          status: "processing",
          code: "WORKFLOW_SETTLEMENT_PENDING",
          jobId,
        },
      };
    case "workflow_start_ambiguous":
      return {
        status: 202,
        body: {
          status: "processing",
          code: "WORKFLOW_START_STATE_UNKNOWN",
          jobId,
        },
      };
    case "legacy":
      throw new Error("Legacy settlement responses are owned by finishMeteredAttempt.");
  }
}
