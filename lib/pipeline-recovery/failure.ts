import { failJob, cancelJob, getJob, type Job } from "@/lib/jobs-db";
import { refundCredits } from "@/lib/credits-db";
import { purgeResumableJobStorage } from "./storage";
import { parseRecoveryManifest } from "./manifest";
import {
  shouldRefundRecoverableTerminal,
  type RecoverableTerminalReason,
} from "./refund-policy-pure";

export async function terminalGenerationFailure(params: {
  profileId: string;
  userId: string;
  jobId: string;
  jobType: string;
  creditsAmount: number;
  reason: Record<string, unknown> | string;
  refund?: boolean;
  purge?: boolean;
  cancelled?: boolean;
}): Promise<void> {
  const errJson =
    typeof params.reason === "string" ? { message: params.reason } : params.reason;

  if (params.purge) {
    await purgeResumableJobStorage(params.userId, params.jobId);
  }

  if (params.cancelled) {
    await cancelJob(params.profileId, params.jobId, errJson);
  } else {
    await failJob(params.profileId, params.jobId, errJson);
  }

  if (params.refund && params.creditsAmount > 0) {
    try {
      await refundCredits({
        profileId: params.profileId,
        amount: params.creditsAmount,
        idempotencyKey: `refund:${params.jobType}:${params.jobId}`,
        jobId: params.jobId,
        description: params.cancelled
          ? "Refund after user cancellation"
          : "Refund after terminal generation failure",
        metadata: {
          reason: params.cancelled ? "generation_cancelled" : "generation_failed",
          originalError: errJson,
        },
      });
    } catch (e) {
      console.warn("[pipeline-recovery] refund failed (non-fatal):", e);
    }
  }
}

export async function abandonRecoverableJob(params: {
  profileId: string;
  userId: string;
  jobId: string;
  jobType: string;
  creditsAmount: number;
  reason?: string;
}): Promise<Job | null> {
  await terminalGenerationFailure({
    profileId: params.profileId,
    userId: params.userId,
    jobId: params.jobId,
    jobType: params.jobType,
    creditsAmount: params.creditsAmount,
    reason: {
      code: "GENERATION_ABANDONED",
      message: params.reason ?? "Recovery abandoned by user.",
    },
    refund: shouldRefundRecoverableTerminal({ reason: "user_abandon" }),
    purge: true,
    cancelled: true,
  });
  return getJob(params.profileId, params.jobId);
}

/** Close a recoverable job after TTL or delivery failure — refund only when policy allows. */
export async function closeRecoverableJobTerminal(params: {
  profileId: string;
  userId: string;
  jobId: string;
  jobType: string;
  creditsAmount: number;
  reason: RecoverableTerminalReason;
  resumeAttempts?: number;
  message: string;
  code: string;
}): Promise<void> {
  await terminalGenerationFailure({
    profileId: params.profileId,
    userId: params.userId,
    jobId: params.jobId,
    jobType: params.jobType,
    creditsAmount: params.creditsAmount,
    reason: { code: params.code, message: params.message },
    refund: shouldRefundRecoverableTerminal({
      reason: params.reason,
      resumeAttempts: params.resumeAttempts,
    }),
    purge: true,
  });
}

export function userIdFromJob(job: Job, fallbackUserId?: string): string | null {
  const fromRecovery = parseRecoveryManifest(job.output)?.storagePrefix?.split("/")[0];
  if (fromRecovery && fromRecovery.length > 0) return fromRecovery;
  const fromInput = job.input?.userId;
  if (typeof fromInput === "string" && fromInput) return fromInput;
  return fallbackUserId ?? null;
}
