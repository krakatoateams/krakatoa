import type { ExecutionBackend } from "./types";

type SettleWorkflowFailure = typeof import("./stop-settlement-core")["settleWorkflowFailure"];
type WorkflowFailureParams = Parameters<SettleWorkflowFailure>[0];

export type MotionControlRouteFailureResult<T> =
  | { kind: "workflow_settled" }
  | { kind: "workflow_start_ambiguous" }
  | { kind: "legacy"; result: T };

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
    await ops.settleWorkflowFailure(input.workflowFailure);
    return { kind: "workflow_settled" };
  }

  return { kind: "workflow_start_ambiguous" };
}
