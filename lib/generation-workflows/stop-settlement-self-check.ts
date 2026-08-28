import {
  isLegacyJobForceStoppable,
  isStopRefundEligible,
  isWorkflowHeartbeatStale,
  isWorkflowRunAbandoned,
  LEGACY_FORCE_STOP_STALE_MS,
  WORKFLOW_ABANDONED_AFTER_MS,
  WORKFLOW_HEARTBEAT_STALE_MS,
} from "./stop-settlement-pure";
import { isTerminalJobStatus } from "./control-policy-pure";

/** ponytail: runnable without Supabase — settlement/refund decision invariants. */
export function stopSettlementSelfCheck(): void {
  if (!isStopRefundEligible({ providerCommittedAt: null, cancelAllowed: true })) {
    throw new Error("pre-commit legacy must refund");
  }
  if (isStopRefundEligible({ providerCommittedAt: "2026-01-01T00:00:00.000Z", cancelAllowed: true })) {
    throw new Error("post-commit provider timestamp must not refund");
  }
  if (isStopRefundEligible({ providerCommittedAt: null, cancelAllowed: false })) {
    throw new Error("legacy cancel_allowed=false must not refund");
  }

  const now = Date.parse("2026-08-14T01:00:00.000Z");
  const freshUpdated = "2026-08-14T00:55:00.000Z";
  const staleUpdated = "2026-08-14T00:40:00.000Z";
  if (isLegacyJobForceStoppable(freshUpdated, now)) {
    throw new Error("fresh legacy job must not be force-stoppable");
  }
  if (!isLegacyJobForceStoppable(staleUpdated, now)) {
    throw new Error("stale legacy job must be force-stoppable");
  }
  if (LEGACY_FORCE_STOP_STALE_MS !== 10 * 60 * 1000) {
    throw new Error("legacy stale threshold must be 10 minutes");
  }

  if (!isWorkflowHeartbeatStale(null, staleUpdated, now)) {
    throw new Error("workflow heartbeat stale should fall back to updated_at");
  }
  if (isWorkflowHeartbeatStale("2026-08-14T00:59:00.000Z", staleUpdated, now)) {
    throw new Error("a fresh heartbeat must win over an old updated_at");
  }
  if (WORKFLOW_HEARTBEAT_STALE_MS !== 5 * 60 * 1000) {
    throw new Error("workflow heartbeat stale threshold must be 5 minutes");
  }

  if (isWorkflowRunAbandoned(null, staleUpdated, now)) {
    throw new Error("a merely stale run must not be settled as abandoned");
  }
  if (!isWorkflowRunAbandoned(null, "2026-08-13T23:00:00.000Z", now)) {
    throw new Error("a run idle for hours must be settled as abandoned");
  }
  if (WORKFLOW_ABANDONED_AFTER_MS <= WORKFLOW_HEARTBEAT_STALE_MS) {
    throw new Error("abandon threshold must stay far beyond the UI stale hint");
  }

  if (!isTerminalJobStatus("failed")) {
    throw new Error("failed must be terminal for settlement guard");
  }
}

if (process.argv[1]?.includes("stop-settlement-self-check")) {
  stopSettlementSelfCheck();
  console.log("stop-settlement self-check ok");
}
