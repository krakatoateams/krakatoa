/** Pure helpers for provider-commit cancel/refund policy (no DB). */

export function commitLockedFromCancelAllowed(cancelAllowed: boolean | undefined | null): boolean {
  return cancelAllowed === false;
}

/** Mirrors isRefundableUserCancellation when lock state is already known. */
export function isRefundableUserCancellationPure(
  isCancelError: boolean,
  commitLocked: boolean,
  hasGenerationRequestId: boolean,
): boolean {
  if (!isCancelError) return false;
  if (!hasGenerationRequestId) return true;
  return !commitLocked;
}

/** Spent credits refund only when the provider output was not committed. */
export function shouldRefundSpentCreditsAfterFailure(params: {
  creditsSpent: boolean;
  creditsAmount: number;
  commitLocked: boolean;
}): boolean {
  return params.creditsSpent && params.creditsAmount > 0 && !params.commitLocked;
}
