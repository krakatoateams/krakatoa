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

/**
 * Cancel-vs-commit arbitration on one `generation_requests` row. Each function mirrors ONE atomic
 * DB statement (the row predicate is the `.eq()` filters of the matching query in
 * `generation-cancel.ts` / `generation-commit.ts`), so the first writer wins and the loser sees 0 rows.
 */
export type CancelRow = { cancel_allowed: boolean; cancel_requested: boolean };

/** `requestCancel`: sets cancel_requested only while cancel is still allowed. */
export function casRequestCancel(row: CancelRow): { row: CancelRow; accepted: boolean } {
  if (!row.cancel_allowed) return { row, accepted: false };
  return { row: { ...row, cancel_requested: true }, accepted: true };
}

/** `lockProviderUnlessCancelRequested`: locks only when no cancel is in flight. */
export function casLockUnlessCancelRequested(row: CancelRow): { row: CancelRow; locked: boolean } {
  if (!row.cancel_allowed) return { row, locked: true }; // already committed
  if (row.cancel_requested) return { row, locked: false }; // cancel won: follow its outcome
  return { row: { ...row, cancel_allowed: false }, locked: true };
}

/** `markProviderCommitted`: unconditional commit (cancel refused, unconfirmed or raced). */
export function forceCommitRow(): CancelRow {
  return { cancel_allowed: false, cancel_requested: false };
}
