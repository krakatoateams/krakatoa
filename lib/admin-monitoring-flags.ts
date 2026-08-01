import {
  shouldRefundRecoverableTerminal,
  type RecoverableTerminalReason,
} from "./pipeline-recovery/refund-policy-pure";

/**
 * Anomaly classification for the admin monitoring panel.
 *
 * Pure — no Supabase, no clock. Every input is passed in so this file stays
 * runnable as a self-check (`npx tsx lib/admin-monitoring-flags.ts`), mirroring
 * lib/pipeline-recovery/refund-policy-pure.ts.
 *
 * The point of this module is the EXCLUSIONS. There are several paths where a
 * terminal job legitimately keeps the user's credits (post-commit cancel, user
 * abandon, TTL with no resume attempt). Flagging those would drown the panel in
 * false positives, so the refund rule delegates to the existing policy function
 * rather than restating it.
 */

export type JobFlag = "stuck" | "cancel_not_honored" | "refund_missing";

/** Heavy routes are pinned to maxDuration = 300 (Vercel Hobby), so >10min is dead, not slow. */
export const STUCK_AFTER_MS = 10 * 60 * 1000;

/** Grace period for the running route to observe cancel_requested between steps. */
export const CANCEL_GRACE_MS = 2 * 60 * 1000;

const ACTIVE_STATUSES = new Set(["queued", "running"]);
const TERMINAL_UNHAPPY_STATUSES = new Set(["failed", "cancelled"]);

/**
 * jobs.error.code values written when a recoverable job is closed for good.
 * Maps back to the reason enum so the refund expectation comes from
 * shouldRefundRecoverableTerminal() instead of a second copy of the rules.
 */
const RECOVERABLE_TERMINAL_CODES: Record<string, RecoverableTerminalReason> = {
  GENERATION_ABANDONED: "user_abandon",
  RECOVERY_TTL_EXPIRED: "ttl_expired",
  RESUME_EXHAUSTED: "resume_exhausted",
  DELIVERY_FAILED: "terminal_delivery_failure",
};

/** Failures that happen before spendCredits — there is nothing to refund. */
const PRE_SPEND_CODES = new Set([
  "INSUFFICIENT_CREDITS",
  "PRICING_CONFIG_MISSING",
  "TOOL_DISABLED",
  "IDEMPOTENCY_KEY_REQUIRED",
  "IDEMPOTENCY_CONFLICT",
  "GENERATION_IN_PROGRESS",
]);

export type JobFlagInput = {
  /** jobs.status */
  status: string;
  /** jobs.error.code, when the route wrote a structured error. */
  errorCode?: string | null;
  /** jobs.updated_at as epoch ms. */
  updatedAtMs: number;
  nowMs: number;
  /** generation_requests.cancel_requested */
  cancelRequested: boolean;
  /** generation_requests.updated_at as epoch ms — when the cancel flag was last written. */
  cancelRequestedAtMs?: number | null;
  /** generation_requests.cancel_allowed — false once provider output is committed. */
  cancelAllowed: boolean;
  /** Σ credit_transactions where type='spend' */
  spentCredits: number;
  /** Σ credit_transactions where type='refund' */
  refundedCredits: number;
  /** jobs.output.recovery.resumeAttempts */
  resumeAttempts?: number;
};

/**
 * True when this terminal job kept credits it should have given back.
 * Returns false for every known-correct no-refund path.
 */
export function isRefundMissing(j: JobFlagInput): boolean {
  if (!TERMINAL_UNHAPPY_STATUSES.has(j.status)) return false;
  if (j.spentCredits <= j.refundedCredits) return false;

  const code = j.errorCode ?? null;
  if (code && PRE_SPEND_CODES.has(code)) return false;

  // User cancelled after the provider already delivered — provider cost is
  // committed, so keeping the credits is the intended behavior.
  if (!j.cancelAllowed) return false;

  const recoverableReason = code ? RECOVERABLE_TERMINAL_CODES[code] : undefined;
  if (recoverableReason) {
    return shouldRefundRecoverableTerminal({
      reason: recoverableReason,
      resumeAttempts: j.resumeAttempts,
    });
  }

  // Plain failure / plain pre-commit cancel: a refund was owed and is missing.
  return true;
}

/** All anomalies for one job row. Empty array = healthy. */
export function classifyJobFlags(j: JobFlagInput): JobFlag[] {
  const flags: JobFlag[] = [];
  const active = ACTIVE_STATUSES.has(j.status);

  if (active && j.nowMs - j.updatedAtMs > STUCK_AFTER_MS) {
    flags.push("stuck");
  }

  // cancel_allowed === false is the post-commit lock, not a bug: the API
  // correctly answers 409 CANCEL_NOT_ALLOWED and the run finishes.
  if (
    active &&
    j.cancelRequested &&
    j.cancelAllowed &&
    j.nowMs - (j.cancelRequestedAtMs ?? j.updatedAtMs) > CANCEL_GRACE_MS
  ) {
    flags.push("cancel_not_honored");
  }

  if (isRefundMissing(j)) flags.push("refund_missing");

  return flags;
}

const MIN = 60 * 1000;

function base(patch: Partial<JobFlagInput> = {}): JobFlagInput {
  return {
    status: "succeeded",
    updatedAtMs: 1_000_000,
    nowMs: 1_000_000,
    cancelRequested: false,
    cancelAllowed: true,
    spentCredits: 0,
    refundedCredits: 0,
    ...patch,
  };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** ponytail: runnable without Supabase — fails if anomaly classification breaks. */
export function adminMonitoringFlagsSelfCheck(): void {
  const t = 1_000_000;

  assert(
    classifyJobFlags(base({ status: "succeeded", spentCredits: 10 })).length === 0,
    "healthy succeeded job must have no flags"
  );

  // stuck
  assert(
    classifyJobFlags(base({ status: "running", updatedAtMs: t, nowMs: t + 20 * MIN })).includes(
      "stuck"
    ),
    "running job idle 20min must be stuck"
  );
  assert(
    !classifyJobFlags(base({ status: "running", updatedAtMs: t, nowMs: t + 3 * MIN })).includes(
      "stuck"
    ),
    "running job idle 3min must not be stuck"
  );
  assert(
    !classifyJobFlags(base({ status: "recoverable", updatedAtMs: t, nowMs: t + 60 * MIN })).includes(
      "stuck"
    ),
    "recoverable job is parked by design, not stuck"
  );

  // cancel_not_honored
  assert(
    classifyJobFlags(
      base({
        status: "running",
        cancelRequested: true,
        cancelRequestedAtMs: t,
        nowMs: t + 5 * MIN,
      })
    ).includes("cancel_not_honored"),
    "cancel requested 5min ago on a running job must flag"
  );
  assert(
    !classifyJobFlags(
      base({
        status: "running",
        cancelRequested: true,
        cancelAllowed: false,
        cancelRequestedAtMs: t,
        nowMs: t + 30 * MIN,
      })
    ).includes("cancel_not_honored"),
    "post-commit lock (cancel_allowed=false) is not an anomaly"
  );
  assert(
    !classifyJobFlags(
      base({
        status: "running",
        cancelRequested: true,
        cancelRequestedAtMs: t,
        nowMs: t + 30 * 1000,
      })
    ).includes("cancel_not_honored"),
    "cancel within the grace period must not flag"
  );

  // refund_missing — the positive case
  assert(
    isRefundMissing(base({ status: "failed", spentCredits: 30, refundedCredits: 0 })),
    "plain failed job with an unrefunded spend must flag"
  );
  assert(
    isRefundMissing(
      base({ status: "cancelled", spentCredits: 30, refundedCredits: 0, cancelRequested: true })
    ),
    "pre-commit user cancel must refund"
  );

  // refund_missing — the exclusions
  assert(
    !isRefundMissing(base({ status: "failed", spentCredits: 30, refundedCredits: 30 })),
    "fully refunded job must not flag"
  );
  assert(
    !isRefundMissing(
      base({ status: "failed", spentCredits: 30, errorCode: "INSUFFICIENT_CREDITS" })
    ),
    "pre-spend failure must not flag"
  );
  assert(
    !isRefundMissing(
      base({
        status: "cancelled",
        spentCredits: 30,
        cancelAllowed: false,
        errorCode: "GENERATION_CANCELLED",
      })
    ),
    "post-commit cancel keeps credits by design"
  );
  assert(
    !isRefundMissing(
      base({ status: "cancelled", spentCredits: 30, errorCode: "GENERATION_ABANDONED" })
    ),
    "user_abandon must not flag"
  );
  assert(
    !isRefundMissing(
      base({
        status: "failed",
        spentCredits: 30,
        errorCode: "RECOVERY_TTL_EXPIRED",
        resumeAttempts: 0,
      })
    ),
    "ttl_expired with zero resume attempts must not flag"
  );
  assert(
    isRefundMissing(
      base({
        status: "failed",
        spentCredits: 30,
        errorCode: "RECOVERY_TTL_EXPIRED",
        resumeAttempts: 2,
      })
    ),
    "ttl_expired after a resume attempt must flag"
  );
  assert(
    isRefundMissing(
      base({ status: "failed", spentCredits: 30, errorCode: "RESUME_EXHAUSTED" })
    ),
    "resume_exhausted must flag"
  );
  assert(
    isRefundMissing(base({ status: "failed", spentCredits: 30, errorCode: "DELIVERY_FAILED" })),
    "terminal_delivery_failure must flag"
  );

  // stacking
  assert(
    classifyJobFlags(
      base({
        status: "running",
        updatedAtMs: t,
        nowMs: t + 30 * MIN,
        cancelRequested: true,
        cancelRequestedAtMs: t,
      })
    ).length === 2,
    "a stuck job with an unhonored cancel must report both flags"
  );
}

if (require.main === module) {
  adminMonitoringFlagsSelfCheck();
  console.log("adminMonitoringFlagsSelfCheck: ok");
}
