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
