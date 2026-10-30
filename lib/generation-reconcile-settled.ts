import { shouldRefundSpentCreditsAfterFailure } from "@/lib/generation-commit-pure";

/** Photo route's terminal refund key (`refund:${refundJobType}:${jobId}`): shared so route + reconcile can never both refund. */
export const photoRefundIdempotencyKey = (jobId: string) => `refund:product_photo:${jobId}`;

export type SettledFailureOps = {
  hasRefund: (jobId: string) => Promise<boolean>;
  spendAmount: (jobId: string) => Promise<number>;
  getRequestId: (profileId: string, jobId: string) => Promise<string | null>;
  isCommitLocked: (profileId: string, requestId: string) => Promise<boolean>;
  confirmsFailure: (profileId: string, requestId: string) => Promise<boolean>;
  refund: (params: {
    profileId: string;
    amount: number;
    idempotencyKey: string;
    jobId: string;
    description: string;
    metadata: Record<string, unknown>;
  }) => Promise<unknown>;
};

/** Reconcile a route-settled failed Fal job whose credits were held (policy: shouldRefundSpentCreditsAfterFailure). */
export async function reconcileSettledProviderFailure(
  ops: SettledFailureOps,
  job: { id: string; profileId: string; costCredits: number },
): Promise<"refunded" | "skipped"> {
  if (await ops.hasRefund(job.id)) return "skipped";
  const spent = await ops.spendAmount(job.id);
  const amount = spent > 0 ? spent : job.costCredits;
  const requestId = await ops.getRequestId(job.profileId, job.id);
  if (!requestId) return "skipped";
  const commitLocked = await ops.isCommitLocked(job.profileId, requestId);
  if (
    !shouldRefundSpentCreditsAfterFailure({
      creditsSpent: true,
      creditsAmount: amount,
      commitLocked,
      definitiveProviderFailure: commitLocked && (await ops.confirmsFailure(job.profileId, requestId)),
    })
  ) {
    return "skipped";
  }
  await ops.refund({
    profileId: job.profileId,
    amount,
    idempotencyKey: photoRefundIdempotencyKey(job.id),
    jobId: job.id,
    description: "Refund after provider-confirmed generation failure (reconcile cron)",
    metadata: { reason: "generation_failed", reconciledAt: new Date().toISOString() },
  });
  return "refunded";
}
