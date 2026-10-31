import { shouldRefundFailedBatchImage, shouldRefundSpentCreditsAfterFailure } from "@/lib/generation-commit-pure";
import { SETTLED_CONFIRM_TIMEOUT_MS, photoRefundIdempotencyKey, withTimeout } from "@/lib/generation-reconcile-settled";
import { PHOTO_STUDIO_MODES, parseGeneratedFilename, photosGeneratedPath, type PhotoStudioMode } from "@/lib/product-photo";

/**
 * S2 per-image settlement (migration 119, `generation_batch_items`). A multi-image Fal request that
 * delivered at least one image and has at least one image with an unknown outcome records one row per
 * image; reconcile refunds exactly an ambiguous image once Fal confirms THAT prediction failed, or
 * delivers it late into the library once Fal confirms it finished (never refunded then).
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

/** An open row as the reconcile scan sees it. `updatedAt` holds `created_at` (the keyset column). */
export type BatchItemCandidate = {
  id: string;
  profileId: string;
  jobId: string;
  batchIndex: number;
  provider: string;
  predictionId: string | null;
  credits: number;
  updatedAt: string;
  state: "ambiguous" | "delivering";
  assetId: string | null;
  /** Stored `saveGeneratedProductPhoto` params (minus userId and bytes). */
  delivery: Record<string, unknown> | null;
};

/** A `delivering` row whose lease (its `updated_at`) is older than this may be reclaimed by another run. */
export const BATCH_ITEM_LEASE_MS = 10 * 60 * 1000;

export type BatchItemDelivery = Record<string, unknown> & { photoMode: PhotoStudioMode; filename: string };

/** The stored save params, or null when they cannot address a canonical generated-photo path. */
export function parseBatchItemDelivery(raw: Record<string, unknown> | null): BatchItemDelivery | null {
  const photoMode = raw?.photoMode;
  const filename = raw?.filename;
  if (typeof photoMode !== "string" || !PHOTO_STUDIO_MODES.includes(photoMode as PhotoStudioMode)) return null;
  if (typeof filename !== "string" || !parseGeneratedFilename(filename)) return null;
  return { ...raw, photoMode: photoMode as PhotoStudioMode, filename };
}

/** Storage refused an `upsert: false` upload because the object exists: a previous attempt saved it. */
export const isStorageAlreadyExists = (e: unknown) => /already exists/i.test(e instanceof Error ? e.message : String(e));

/** Late delivery (phase 3). Every write is a compare-and-set scoped to the row's profile. */
export type LateDeliveryOps = {
  /**
   * `ambiguous -> delivering`, or reclaim a `delivering` row whose `updated_at` is before `staleBefore`;
   * never a row with a refund key (a refund may have been paid). Resolves the new lease token (the row's
   * new `updated_at`), or null when another run holds the row.
   */
  claim: (item: BatchItemCandidate, staleBefore: string) => Promise<string | null>;
  /** Trusted output URL, read fresh from the provider (`*.fal.media` enforced); throws when unavailable. */
  outputUrl: (provider: string, predictionId: string) => Promise<string>;
  download: (url: string) => Promise<ArrayBuffer>;
  /** auth user id of the row's profile (canonical paths start with `{userId}/`). */
  userIdForProfile: (profileId: string) => Promise<string>;
  /** `saveGeneratedProductPhoto` (upload with `upsert: false`, then the library row). */
  save: (params: BatchItemDelivery & { userId: string; imageBuffer: ArrayBuffer }) => Promise<{ storagePath: string }>;
  /** Library row after a storage conflict (an earlier attempt may have died before writing it); a duplicate is a no-op. */
  recordLibrary: (params: BatchItemDelivery & { userId: string; storagePath: string }) => Promise<unknown>;
  /** `markAssetReady`, owner-scoped. */
  markReady: (profileId: string, assetId: string, storagePath: string, credits: number, delivery: BatchItemDelivery) => Promise<unknown>;
  /** `delivering -> delivered_late` (any lease: the image is saved) or back to `ambiguous` (own lease only). */
  finish: (item: BatchItemCandidate, lease: string, to: "delivered_late" | "ambiguous") => Promise<boolean>;
  now?: () => number;
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
  /**
   * Record the refund key on a still-`ambiguous` row before money moves (compare-and-set on the state).
   * Late delivery never claims a row that carries a key; false when another run already took the row.
   */
  markRefund: (item: BatchItemCandidate, refundKey: string) => Promise<boolean>;
  /** Absent: a finished image stays ambiguous (phase 2 behavior). */
  late?: LateDeliveryOps;
};

export type BatchItemOutcome =
  | "refunded"
  | "unresolved"
  | "delivered_late"
  | "left"
  | "leased"
  | "skipped_job"
  | "over_cap"
  | "raced";

/**
 * Reconcile one ambiguous image. Refund only when the provider confirms THIS prediction failed (I4,
 * through the canonical policy), never more than the job spent (I3), under the per-image key (I2).
 * When the provider confirms it finished, it is delivered late instead (`deliverBatchItemLate`).
 * Anything else leaves it ambiguous; past the lookback (`expired`) it becomes `unresolved` (manual review).
 */
export async function settleBatchItem(
  ops: BatchItemOps,
  item: BatchItemCandidate,
  opts: { expired: boolean; confirmTimeoutMs?: number },
): Promise<BatchItemOutcome> {
  // I5: only partly delivered (succeeded) jobs; a running/failed job is owned by the job-level paths.
  if ((await ops.jobStatus(item.profileId, item.jobId)) !== "succeeded") return "skipped_job";
  // A `delivering` row was already confirmed finished; only a stale lease can be reclaimed.
  if (item.state === "delivering") return ops.late ? deliverBatchItemLate(ops, item, opts) : "leased";
  if (!item.predictionId) {
    // Submit itself failed: nothing can ever confirm this image.
    return (await ops.settle(item, "unresolved", null)) ? "unresolved" : "raced";
  }
  const status = await withTimeout(
    ops.predictionStatus(item.provider, item.predictionId),
    opts.confirmTimeoutMs ?? SETTLED_CONFIRM_TIMEOUT_MS,
    "unknown",
  );
  if (status === "succeeded" && ops.late) return deliverBatchItemLate(ops, item, opts);
  const refundable = shouldRefundSpentCreditsAfterFailure({
    creditsSpent: true,
    creditsAmount: item.credits,
    commitLocked: true,
    definitiveProviderFailure: status === "failed",
  });
  if (refundable) {
    // A retry after a failed refund call fits even if the ledger did commit: a delivered image always keeps >= credits of headroom.
    const [spent, refunded] = await Promise.all([ops.spendAmount(item.jobId), ops.refundedAmount(item.jobId)]);
    if (refunded + item.credits <= spent) {
      const key = batchItemRefundKey(item.jobId, item.batchIndex);
      // Mark the row before money moves: an overlapping run that saw "finished" can no longer deliver it
      // (I1). A crash or a refund error leaves it ambiguous with the key; the next run retries the same key.
      if (!(await ops.markRefund(item, key))) return "raced";
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
    // I3: never refund past the spend; past the lookback it goes to manual review like any unconfirmed image.
    if (!opts.expired) return "over_cap";
  } else if (!opts.expired) {
    return "left";
  }
  return (await ops.settle(item, "unresolved", null)) ? "unresolved" : "raced";
}

/**
 * Late delivery of an image the provider confirmed finished: claim (`ambiguous -> delivering`, or a
 * lease older than BATCH_ITEM_LEASE_MS), fresh trusted output URL (I9), download, save under the owner's
 * `{userId}/` with the stored params (same deterministic filename), mark the asset ready, then
 * `delivered_late`. A storage "already exists" conflict on that filename means a previous attempt saved
 * it: delivered. Any failure before the image is stored goes back to `ambiguous` with nothing refunded
 * (the expiry rule still applies); after it is stored the row never returns to `ambiguous` (I1). Never
 * refunds: a run that produced output is charged.
 */
export async function deliverBatchItemLate(
  ops: BatchItemOps,
  item: BatchItemCandidate,
  opts: { expired: boolean; confirmTimeoutMs?: number },
): Promise<BatchItemOutcome> {
  const late = ops.late!;
  const now = late.now?.() ?? Date.now();
  const lease = await late.claim(item, new Date(now - BATCH_ITEM_LEASE_MS).toISOString());
  if (!lease) return "leased";
  let stored: { delivery: BatchItemDelivery; userId: string; storagePath: string; conflict: boolean };
  try {
    const delivery = parseBatchItemDelivery(item.delivery);
    if (!delivery || !item.predictionId) throw new Error("No delivery params.");
    const url = await withTimeout(
      late.outputUrl(item.provider, item.predictionId),
      opts.confirmTimeoutMs ?? SETTLED_CONFIRM_TIMEOUT_MS,
      "",
    );
    if (!url) throw new Error("Output not available.");
    const userId = await late.userIdForProfile(item.profileId);
    if (!userId) throw new Error("Owner not found.");
    const imageBuffer = await late.download(url);
    try {
      stored = { delivery, userId, storagePath: (await late.save({ ...delivery, userId, imageBuffer })).storagePath, conflict: false };
    } catch (e) {
      if (!isStorageAlreadyExists(e)) throw e;
      stored = { delivery, userId, storagePath: photosGeneratedPath(userId, delivery.photoMode, delivery.filename), conflict: true };
    }
  } catch {
    await late.finish(item, lease, "ambiguous");
    if (!opts.expired) return "left";
    return (await ops.settle(item, "unresolved", null)) ? "unresolved" : "raced";
  }
  // Stored: a failure from here leaves the row `delivering`; after the lease the next run reclaims it and
  // takes the conflict path again.
  const { delivery, userId, storagePath, conflict } = stored;
  if (conflict) await late.recordLibrary({ ...delivery, userId, storagePath });
  if (item.assetId) await late.markReady(item.profileId, item.assetId, storagePath, item.credits, delivery);
  return (await late.finish(item, lease, "delivered_late")) ? "delivered_late" : "raced";
}
