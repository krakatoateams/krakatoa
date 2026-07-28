import {
  commitLockedFromCancelAllowed,
  isRefundableUserCancellationPure,
} from "./generation-commit-pure";

/** ponytail: runnable without Supabase — fails if refund/commit pure contract breaks. */
export function generationCommitSelfCheck(): void {
  if (!commitLockedFromCancelAllowed(false)) {
    throw new Error("commitLockedFromCancelAllowed(false) must be true");
  }
  if (commitLockedFromCancelAllowed(true)) {
    throw new Error("commitLockedFromCancelAllowed(true) must be false");
  }
  if (commitLockedFromCancelAllowed(undefined)) {
    throw new Error("commitLockedFromCancelAllowed(undefined) must be false");
  }

  if (!isRefundableUserCancellationPure(true, false, true)) {
    throw new Error("pre-commit cancel must be refundable");
  }
  if (isRefundableUserCancellationPure(true, true, true)) {
    throw new Error("post-commit cancel must not be refundable");
  }
  if (!isRefundableUserCancellationPure(true, false, false)) {
    throw new Error("cancel without request id must be refundable");
  }
  if (isRefundableUserCancellationPure(false, false, true)) {
    throw new Error("non-cancel errors must not be refundable via this gate");
  }
}

if (process.argv[1]?.includes("generation-commit-self-check")) {
  generationCommitSelfCheck();
  console.log("generation-commit self-check ok");
}
