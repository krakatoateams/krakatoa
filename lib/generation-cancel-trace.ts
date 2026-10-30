import { createJobStep } from "@/lib/job-steps-db";
import { generationErrorLogSafe } from "@/lib/error-log-safe";

/**
 * Durable trace of a user cancel attempt, kept as a finished job step (shown in the admin job timeline)
 * because `cancel_requested` is cleared on commit and a refused cancel leaves no other record.
 * Events: `cancel_requested` (cancel endpoint), `cancel_refused` (409), `cancel_outcome` (generate route:
 * confirmed | unconfirmed). Best-effort: never throws, never blocks the cancel or the run.
 */
export type CancelTraceEvent = "cancel_requested" | "cancel_refused" | "cancel_outcome";

export async function recordCancelTrace(params: {
  profileId: string;
  jobId: string | null | undefined;
  event: CancelTraceEvent;
  detail?: Record<string, unknown>;
}): Promise<void> {
  console.info(`[generation-cancel] ${params.event}`, params.detail ?? {});
  if (!params.jobId) return;
  try {
    await createJobStep({
      jobId: params.jobId,
      profileId: params.profileId,
      stepKey: params.event,
      stepName: `Cancel: ${params.event.replace("cancel_", "")}`,
      status: "succeeded",
      input: { at: new Date().toISOString(), ...params.detail },
    });
  } catch (e) {
    console.warn("[generation-cancel] trace failed:", generationErrorLogSafe(e));
  }
}
