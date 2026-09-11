import {
  resolveMotionControlRouteFailureHttp,
  settleMotionControlRouteFailure,
} from "./motion-control-route-failure";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

export async function motionControlRouteFailureSelfCheck(): Promise<void> {
  let workflowSettlements = 0;
  let legacySettlements = 0;

  const result = await settleMotionControlRouteFailure(
    {
      executionBackend: "workflow",
      workflowStartAttempted: false,
      workflowFailure: {
        profileId: "profile-1",
        userId: "user-1",
        jobId: "job-1",
        generationRequestId: "request-1",
        errorJson: { message: "reference resolution failed" },
      },
      finishLegacy: async () => {
        legacySettlements += 1;
        return "legacy";
      },
    },
    {
      settleWorkflowFailure: async () => {
        workflowSettlements += 1;
      },
    },
  );

  assert(result.kind === "workflow_settled", "pre-start workflow failure must settle atomically");
  assert(workflowSettlements === 1, "workflow failure settlement must run exactly once");
  assert(legacySettlements === 0, "workflow failure must not use legacy settlement");

  const settledHttp = resolveMotionControlRouteFailureHttp(result, "job-1");
  assert(settledHttp.status === 500, "settled workflow start failure must remain an error");
  assert(
    settledHttp.body.code === "WORKFLOW_START_FAILED" &&
      settledHttp.body.settled === true &&
      settledHttp.body.jobId === "job-1",
    "settled workflow start failure must return a structured terminal response",
  );

  const pendingResult = await settleMotionControlRouteFailure(
    {
      executionBackend: "workflow",
      workflowStartAttempted: false,
      workflowFailure: {
        profileId: "profile-1",
        userId: "user-1",
        jobId: "job-1",
        generationRequestId: "request-1",
        errorJson: { message: "reference resolution failed" },
      },
      finishLegacy: async () => {
        legacySettlements += 1;
        return "legacy";
      },
    },
    {
      settleWorkflowFailure: async () => {
        throw new Error("database unavailable");
      },
    },
  );

  assert(
    pendingResult.kind === "workflow_settlement_pending",
    "failed canonical settlement must stay pending for reconciliation",
  );
  assert(legacySettlements === 0, "failed workflow settlement must not fall back to legacy");
  const pendingHttp = resolveMotionControlRouteFailureHttp(pendingResult, "job-1");
  assert(
    pendingHttp.status === 202 &&
      pendingHttp.body.status === "processing" &&
      pendingHttp.body.code === "WORKFLOW_SETTLEMENT_PENDING",
    "failed canonical settlement must return an explicit pending response",
  );

  const legacyResult = await settleMotionControlRouteFailure(
    {
      executionBackend: "legacy",
      finishLegacy: async () => {
        legacySettlements += 1;
        return "legacy";
      },
    },
    {
      settleWorkflowFailure: async () => {
        workflowSettlements += 1;
      },
    },
  );

  assert(
    legacyResult.kind === "legacy" && legacyResult.result === "legacy",
    "legacy backend must preserve its existing settlement result",
  );
  assert(legacySettlements === 1, "legacy settlement must run exactly once");
  assert(workflowSettlements === 1, "legacy failure must not use workflow settlement");

  const ambiguousResult = await settleMotionControlRouteFailure(
    {
      executionBackend: "workflow",
      workflowStartAttempted: true,
      workflowFailure: {
        profileId: "profile-1",
        userId: "user-1",
        jobId: "job-1",
        generationRequestId: "request-1",
        errorJson: { message: "workflow start response was lost" },
      },
      finishLegacy: async () => {
        legacySettlements += 1;
        return "legacy";
      },
    },
    {
      settleWorkflowFailure: async () => {
        workflowSettlements += 1;
      },
    },
  );

  assert(
    ambiguousResult.kind === "workflow_start_ambiguous",
    "ambiguous workflow start must stay in progress for workflow or reconcile ownership",
  );
  const ambiguousHttp = resolveMotionControlRouteFailureHttp(ambiguousResult, "job-1");
  assert(
    ambiguousHttp.status === 202 &&
      ambiguousHttp.body.code === "WORKFLOW_START_STATE_UNKNOWN",
    "ambiguous workflow start must return an explicit in-progress response",
  );
  assert(legacySettlements === 1, "ambiguous workflow start must not use legacy settlement");
  assert(workflowSettlements === 1, "ambiguous workflow start must not refund eagerly");
}

if (process.argv[1]?.includes("motion-control-route-failure-self-check")) {
  motionControlRouteFailureSelfCheck()
    .then(() => console.log("motion-control route failure self-check ok"))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
