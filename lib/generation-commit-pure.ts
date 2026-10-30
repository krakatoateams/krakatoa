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

/**
 * Canonical post-failure refund policy. Spent credits refund when the provider output was not
 * committed, or when the provider explicitly reported the run failed (no output produced).
 * Ambiguous outcomes (timeout, network loss, abort after submit) never refund while locked.
 */
export function shouldRefundSpentCreditsAfterFailure(params: {
  creditsSpent: boolean;
  creditsAmount: number;
  commitLocked: boolean;
  definitiveProviderFailure?: boolean;
}): boolean {
  return (
    params.creditsSpent &&
    params.creditsAmount > 0 &&
    (!params.commitLocked || !!params.definitiveProviderFailure)
  );
}

/**
 * Batch partial refund for one failed image. Providers that commit on submit (Fal) refund only a
 * definitive failure; others keep refunding every image that never materialized.
 */
export function shouldRefundFailedBatchImage(params: {
  commitsOnSubmit: boolean;
  definitiveProviderFailure: boolean;
}): boolean {
  return !params.commitsOnSubmit || params.definitiveProviderFailure;
}
