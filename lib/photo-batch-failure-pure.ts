import { shouldRefundFailedBatchImage } from "@/lib/generation-commit-pure";

/**
 * Failure plan for a photo batch (one prediction per image, one request-level cancel lock).
 * A Fal cancellation (`removedFromQueue`) is thrown by the adapter only after Fal confirmed the queued
 * request was removed: no output, no charge. Fully cancelled batch => the outer cancel path refunds the
 * whole spend once (so no partial refund here). If another image already ran (cancel raced), the cancel
 * is refused for the request: the removed images are refunded like definitive failures, the rest deliver.
 */
export function planBatchFailures(p: {
  rejections: unknown[];
  commitsOnSubmit: boolean;
  cancelWhileQueued: boolean;
  isDefinitive: (reason: unknown) => boolean;
  isCancelled: (reason: unknown) => boolean;
}): { refundableFailures: number; fullyCancelled: boolean; ambiguous: unknown } {
  const removed = (r: unknown) => p.cancelWhileQueued && p.isCancelled(r);
  const definitiveOrRemoved = (r: unknown) => p.isDefinitive(r) || removed(r);
  return {
    refundableFailures: p.rejections.filter((r) =>
      shouldRefundFailedBatchImage({ commitsOnSubmit: p.commitsOnSubmit, definitiveProviderFailure: definitiveOrRemoved(r) }),
    ).length,
    fullyCancelled: p.rejections.length > 0 && p.rejections.every(removed),
    ambiguous: p.rejections.find((r) => !definitiveOrRemoved(r)),
  };
}

/**
 * What the route does when a batch delivered 0 images: refund the refundable images first (only when an
 * ambiguous one keeps the job held) and which reason to throw to the outer catch. Order independent:
 * ambiguous wins (held, reconcile), then a definitive one (outer refunds the whole spend), else the first.
 * A fully cancelled batch throws the cancel so the outer cancel path refunds once.
 */
export function settleZeroSuccessBatch(p: Parameters<typeof planBatchFailures>[0]): { refundFirst: boolean; reason: unknown } {
  const plan = planBatchFailures(p);
  const first = p.rejections.length > 0 ? p.rejections[0] : new Error("Image generation failed");
  if (plan.fullyCancelled || !p.commitsOnSubmit) return { refundFirst: false, reason: first };
  if (plan.ambiguous !== undefined) return { refundFirst: true, reason: plan.ambiguous };
  return { refundFirst: false, reason: p.rejections.find(p.isDefinitive) ?? first };
}
