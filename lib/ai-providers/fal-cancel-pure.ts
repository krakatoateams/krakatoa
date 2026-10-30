import { ApiError } from "@fal-ai/client";

/**
 * What Fal answered to `PUT /requests/{id}/cancel` (queue OpenAPI, see the fal runbook):
 * 200 `OK` = was queued, removed, never runs; 202 `CANCELLATION_REQUESTED` = already running, only
 * signalled, may still finish and bill; 400 `ALREADY_COMPLETED` = too late. Only "removed" can refund.
 */
export type FalCancelResult = "removed" | "signalled" | "already_completed" | "unknown";

export function classifyFalCancel(httpStatus: number, bodyStatus?: string): FalCancelResult {
  if (httpStatus === 200 && bodyStatus === "OK") return "removed";
  if (httpStatus === 202 && bodyStatus === "CANCELLATION_REQUESTED") return "signalled";
  if (httpStatus === 400 && bodyStatus === "ALREADY_COMPLETED") return "already_completed";
  return "unknown";
}

/** A 4xx answer (not 408/429) means Fal says there is no output; 5xx/timeouts/network stay ambiguous. */
export function isDefinitiveFalApiError(e: unknown): boolean {
  return e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;
}
