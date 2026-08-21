import type { StopSettlementParams, StopSettlementResult } from "./stop-settlement-types";

export type { StopSettlementParams, StopSettlementResult } from "./stop-settlement-types";

export async function generationStopSettlementWorkflow(
  params: StopSettlementParams,
): Promise<StopSettlementResult> {
  "use workflow";
  return settleGenerationStopStep(params);
}

async function settleGenerationStopStep(
  params: StopSettlementParams,
): Promise<StopSettlementResult> {
  "use step";
  console.log("[stop-settlement] settling", params.jobId);
  const { settleGenerationStop } = await import("./stop-settlement-core");
  const result = await settleGenerationStop(params);
  console.log("[stop-settlement] done", params.jobId, result.action);
  return result;
}
