/** Why a recoverable job closed without delivering the final asset. */
export type RecoverableTerminalReason =
  | "resume_exhausted"
  | "terminal_delivery_failure"
  | "ttl_expired"
  | "user_abandon";

/**
 * After provider output exists, refund only when delivery genuinely failed —
 * not when the user voluntarily abandons a recoverable job.
 */
export function shouldRefundRecoverableTerminal(params: {
  reason: RecoverableTerminalReason;
  resumeAttempts?: number;
}): boolean {
  switch (params.reason) {
    case "resume_exhausted":
    case "terminal_delivery_failure":
      return true;
    case "ttl_expired":
      // User tried at least once; we still could not deliver.
      return (params.resumeAttempts ?? 0) >= 1;
    case "user_abandon":
      return false;
    default: {
      const _exhaustive: never = params.reason;
      return _exhaustive;
    }
  }
}

/** ponytail: runnable without Supabase — fails if recoverable refund policy breaks. */
export function recoverableRefundPolicySelfCheck(): void {
  if (!shouldRefundRecoverableTerminal({ reason: "resume_exhausted" })) {
    throw new Error("resume_exhausted must refund");
  }
  if (!shouldRefundRecoverableTerminal({ reason: "terminal_delivery_failure" })) {
    throw new Error("terminal_delivery_failure must refund");
  }
  if (shouldRefundRecoverableTerminal({ reason: "user_abandon" })) {
    throw new Error("user_abandon must not refund");
  }
  if (shouldRefundRecoverableTerminal({ reason: "ttl_expired", resumeAttempts: 0 })) {
    throw new Error("ttl_expired with zero resume attempts must not refund");
  }
  if (!shouldRefundRecoverableTerminal({ reason: "ttl_expired", resumeAttempts: 1 })) {
    throw new Error("ttl_expired after resume attempts must refund");
  }
}

if (require.main === module) {
  recoverableRefundPolicySelfCheck();
  console.log("recoverableRefundPolicySelfCheck: ok");
}
