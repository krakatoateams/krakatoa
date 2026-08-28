export { isRefundEligible as isStopRefundEligible } from "./control-policy-pure";

/** Legacy zombie force-stop threshold (updated_at). */
export const LEGACY_FORCE_STOP_STALE_MS = 10 * 60 * 1000;

/** Workflow heartbeat considered stale for UI/reconcile hints. */
export const WORKFLOW_HEARTBEAT_STALE_MS = 5 * 60 * 1000;

/**
 * Heartbeat gap after which nothing is driving the durable run anymore, so the
 * reconcile cron settles it. Far beyond the UI stale hint: a run that merely looks
 * quiet must never be settled out from under an executor that is still alive.
 */
export const WORKFLOW_ABANDONED_AFTER_MS = 60 * 60 * 1000;

export function isLegacyJobForceStoppable(
  updatedAt: string,
  nowMs: number = Date.now(),
): boolean {
  const ageMs = nowMs - Date.parse(updatedAt);
  return Number.isFinite(ageMs) && ageMs >= LEGACY_FORCE_STOP_STALE_MS;
}

/** Unparseable timestamps read as "just seen" so neither threshold can fire on them. */
function workflowIdleMs(
  heartbeatAt: string | null | undefined,
  updatedAt: string,
  nowMs: number,
): number {
  const ageMs = nowMs - Date.parse(heartbeatAt ?? updatedAt);
  return Number.isFinite(ageMs) ? ageMs : 0;
}

export function isWorkflowHeartbeatStale(
  heartbeatAt: string | null | undefined,
  updatedAt: string,
  nowMs: number = Date.now(),
): boolean {
  return workflowIdleMs(heartbeatAt, updatedAt, nowMs) >= WORKFLOW_HEARTBEAT_STALE_MS;
}

export function isWorkflowRunAbandoned(
  heartbeatAt: string | null | undefined,
  updatedAt: string,
  nowMs: number = Date.now(),
): boolean {
  return workflowIdleMs(heartbeatAt, updatedAt, nowMs) >= WORKFLOW_ABANDONED_AFTER_MS;
}
