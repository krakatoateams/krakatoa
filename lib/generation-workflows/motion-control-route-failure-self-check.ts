import { settleMotionControlRouteFailure } from "./motion-control-route-failure";

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
