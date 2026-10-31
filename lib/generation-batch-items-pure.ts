import { shouldRefundFailedBatchImage, shouldRefundSpentCreditsAfterFailure } from "@/lib/generation-commit-pure";
import { SETTLED_CONFIRM_TIMEOUT_MS, photoRefundIdempotencyKey, withTimeout } from "@/lib/generation-reconcile-settled";

/**
 * S2 per-image settlement (migration 119, `generation_batch_items`). A multi-image Fal request that
 * delivered at least one image and has at least one image with an unknown outcome records one row per
 * image; reconcile refunds exactly an ambiguous image once Fal confirms THAT prediction failed.
 * See docs/generation/fal-provider-runbook.md "Per-image settlement (S2)".
 */
export type BatchItemState =
  | "delivered"
  | "failed_definitive"
  | "cancelled_confirmed"
  | "ambiguous"
  | "delivering"
  | "refunded"
  | "delivered_late"
  | "unresolved";

/** One stable refund key per image (I2); the ledger returns the existing row on a replay. */
export const batchItemRefundKey = (jobId: string, batchIndex: number) =>
  `${photoRefundIdempotencyKey(jobId)}:item:${batchIndex}`;

export type BatchItemRow = {
  job_id: string;
  profile_id: string;
  generation_request_id: string | null;
  batch_index: number;
  asset_id: string | null;
  provider: string;
  prediction_id: string | null;
  output_url: string | null;
  credits: number;
  state: BatchItemState;
  refund_idempotency_key: string | null;
  delivery: Record<string, unknown> | null;
  settled_at: string | null;
};

/**
 * Route side: the rows for one settled batch, or null when this batch writes none. Rows exist only for
 * commit-on-submit providers (I6), more than one image, at least one delivered image (I5: zero-success
 * batches stay on the job-level path) and at least one ambiguous image. Classification is the same as
 * `planBatchFailures`: refundable = definitive or confirmed removed; everything else is ambiguous.
 */
export function planBatchItemRows(p: {
  jobId: string;
  profileId: string;
  generationRequestId: string | null;
  provider: { id: string; commitsOnSubmit: boolean; cancelWhileQueued: boolean };
  outcomes: PromiseSettledResult<unknown>[];
  predictionIds: (string | undefined)[];
  outputUrls: (string | undefined)[];
  assetIds: string[];
  /** `saveGeneratedProductPhoto` params minus userId and bytes (late delivery, phase 3). */
  delivery: (index: number) => Record<string, unknown>;
  perImageCredits: number;
  isDefinitive: (reason: unknown) => boolean;
  isCancelled: (reason: unknown) => boolean;
  nowIso: string;
}): BatchItemRow[] | null {
  if (!p.provider.commitsOnSubmit || p.outcomes.length < 2) return null;
  const states = p.outcomes.map((o): BatchItemState => {
    if (o.status === "fulfilled") return "delivered";
    const removed = p.provider.cancelWhileQueued && p.isCancelled(o.reason);
    const refundable = shouldRefundFailedBatchImage({
      commitsOnSubmit: true,
      definitiveProviderFailure: removed || p.isDefinitive(o.reason),
    });
    return !refundable ? "ambiguous" : removed ? "cancelled_confirmed" : "failed_definitive";
  });
  if (!states.includes("delivered") || !states.includes("ambiguous")) return null;
  return states.map((state, index) => {
    const ambiguous = state === "ambiguous";
    return {
      job_id: p.jobId,
      profile_id: p.profileId,
      generation_request_id: p.generationRequestId,
      batch_index: index,
      asset_id: p.assetIds[index] ?? null,
      provider: p.provider.id,
      prediction_id: p.predictionIds[index] ?? null,
      output_url: ambiguous ? (p.outputUrls[index] ?? null) : null,
      credits: p.perImageCredits,
      state,
      // The route's batch partial refund covers these images (same key as the route).
      refund_idempotency_key:
        state === "failed_definitive" || state === "cancelled_confirmed" ? `${photoRefundIdempotencyKey(p.jobId)}:partial` : null,
      delivery: ambiguous ? p.delivery(index) : null,
      settled_at: ambiguous ? null : p.nowIso,
    };
  });
}

/** An open (`ambiguous`) row as the reconcile scan sees it. `updatedAt` holds `created_at` (the keyset column). */
export type BatchItemCandidate = {
  id: string;
  profileId: string;
  jobId: string;
  batchIndex: number;
  provider: string;
  predictionId: string | null;
  credits: number;
  updatedAt: string;
};

export type BatchItemOps = {
  jobStatus: (profileId: string, jobId: string) => Promise<string | null>;
  /** Provider status of one prediction; throws when unknown (network, 404, 5xx). */
  predictionStatus: (provider: string, predictionId: string) => Promise<string>;
  refundedAmount: (jobId: string) => Promise<number>;
  spendAmount: (jobId: string) => Promise<number>;
  refund: (params: {
    profileId: string;
    amount: number;
    idempotencyKey: string;
    jobId: string;
    description: string;
    metadata: Record<string, unknown>;
  }) => Promise<unknown>;
  /** Compare-and-set `ambiguous -> to` scoped to the row's profile; false when another run won. */
  settle: (item: BatchItemCandidate, to: "refunded" | "unresolved", refundKey: string | null) => Promise<boolean>;
};

export type BatchItemOutcome = "refunded" | "unresolved" | "left" | "skipped_job" | "over_cap" | "raced";

/**
 * Reconcile one ambiguous image. Refund only when the provider confirms THIS prediction failed (I4,
 * through the canonical policy), never more than the job spent (I3), under the per-image key (I2).
 * Anything else leaves it ambiguous; past the lookback (`expired`) it becomes `unresolved` (manual review).
 */
export async function settleBatchItem(
  ops: BatchItemOps,
  item: BatchItemCandidate,
  opts: { expired: boolean; confirmTimeoutMs?: number },
): Promise<BatchItemOutcome> {
  // I5: only partly delivered (succeeded) jobs; a running/failed job is owned by the job-level paths.
  if ((await ops.jobStatus(item.profileId, item.jobId)) !== "succeeded") return "skipped_job";
  if (!item.predictionId) {
    // Submit itself failed: nothing can ever confirm this image.
    return (await ops.settle(item, "unresolved", null)) ? "unresolved" : "raced";
  }
  const status = await withTimeout(
    ops.predictionStatus(item.provider, item.predictionId),
    opts.confirmTimeoutMs ?? SETTLED_CONFIRM_TIMEOUT_MS,
    "unknown",
  );
  const refundable = shouldRefundSpentCreditsAfterFailure({
    creditsSpent: true,
    creditsAmount: item.credits,
    commitLocked: true,
    definitiveProviderFailure: status === "failed",
  });
  if (refundable) {
    // A replay of this key after a lost CAS still fits: a delivered image always keeps >= credits of headroom.
    const [spent, refunded] = await Promise.all([ops.spendAmount(item.jobId), ops.refundedAmount(item.jobId)]);
    if (refunded + item.credits > spent) return "over_cap";
    const key = batchItemRefundKey(item.jobId, item.batchIndex);
    await ops.refund({
      profileId: item.profileId,
      amount: item.credits,
      idempotencyKey: key,
      jobId: item.jobId,
      description: "Refund for a batch image the provider confirmed failed (reconcile cron)",
      metadata: { reason: "batch_image_failed", batchIndex: item.batchIndex, reconciledAt: new Date().toISOString() },
    });
    return (await ops.settle(item, "refunded", key)) ? "refunded" : "raced";
  }
  if (!opts.expired) return "left";
  return (await ops.settle(item, "unresolved", null)) ? "unresolved" : "raced";
}
