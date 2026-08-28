export type WorkflowFinalizeAction =
  | "finalized"
  | "stop_won"
  | "noop_already"
  | "invalid";

export type WorkflowFinalizeResult = {
  action: WorkflowFinalizeAction;
  replay?: boolean;
  storagePath?: string;
  creationId?: string;
  reason?: string;
  responseJson?: Record<string, unknown>;
};

export function parseWorkflowFinalizeResult(row: Record<string, unknown>): WorkflowFinalizeResult {
  const action = row.action;
  if (
    action !== "finalized" &&
    action !== "stop_won" &&
    action !== "noop_already" &&
    action !== "invalid"
  ) {
    throw new Error("parseWorkflowFinalizeResult: unexpected action");
  }
  return {
    action,
    replay: row.replay === true,
    storagePath: typeof row.storagePath === "string" ? row.storagePath : undefined,
    creationId: typeof row.creationId === "string" ? row.creationId : undefined,
    reason: typeof row.reason === "string" ? row.reason : undefined,
    responseJson:
      row.responseJson && typeof row.responseJson === "object"
        ? (row.responseJson as Record<string, unknown>)
        : undefined,
  };
}