import { shouldRefundSpentCreditsAfterFailure } from "@/lib/generation-commit-pure";

/** Photo route's terminal refund key (`refund:${refundJobType}:${jobId}`): shared so route + reconcile can never both refund. */
export const photoRefundIdempotencyKey = (jobId: string) => `refund:product_photo:${jobId}`;

/** Route-settled ambiguous Fal failures stay eligible for reconcile this long (reconcile runs every 10 min via cron-job.org; GitHub Actions and the daily Vercel cron are backups). */
export const SETTLED_LOOKBACK_MS = 72 * 60 * 60 * 1000;
/** Failures this fresh are left to the next run (the route may still be finishing its own settlement). */
export const SETTLED_MIN_AGE_MS = 5 * 60 * 1000;
/** After expiry, jobs are still visited (final confirm + unresolved mark) for this much longer. */
export const SETTLED_EXPIRY_BAND_MS = 7 * 24 * 60 * 60 * 1000;
export const SETTLED_PAGE_SIZE = 50;
/** Jobs reconciled in parallel: caps simultaneous Fal calls. */
export const SETTLED_CONCURRENCY = 4;
/** Stop starting new batches after this long; leftovers wait for the next run (route maxDuration is 120 s). */
export const SETTLED_BUDGET_MS = 45_000;
/** Per-job cap on Fal status calls; a slow Fal counts as "not confirmed". */
export const SETTLED_CONFIRM_TIMEOUT_MS = 15_000;

/** Resolves to `fallback` if `p` has not settled within `ms` (rejections also map to `fallback`). */
export async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p.catch(() => fallback),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Half-open ISO windows over `jobs.updated_at`: active = (from, to), expiry = (from, to] past the lookback. */
export function settledWindows(nowMs: number) {
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    active: { after: iso(nowMs - SETTLED_LOOKBACK_MS), before: iso(nowMs - SETTLED_MIN_AGE_MS) },
    expired: { after: iso(nowMs - SETTLED_LOOKBACK_MS - SETTLED_EXPIRY_BAND_MS), before: iso(nowMs - SETTLED_LOOKBACK_MS) },
  };
}

export type SettledCandidate = { id: string; profileId: string; costCredits: number; updatedAt: string };
export type SettledCursor = { updatedAt: string; id: string } | null;
export type SettledScanResult = {
  scanned: number;
  outcomes: Record<string, number>;
  errors: string[];
  /** Candidates not visited because the budget ran out (picked up next run). */
  left: number;
};

/**
 * Keyset-paged (updated_at, id ascending) walk over every candidate, in batches of `concurrency`,
 * until exhausted or the time budget is spent. A throwing job is recorded and skipped, never retried in-run.
 */
export async function scanSettledJobs(
  deps: {
    fetchPage: (after: SettledCursor, limit: number) => Promise<SettledCandidate[]>;
    countFrom: (after: SettledCursor) => Promise<number>;
    process: (job: SettledCandidate) => Promise<string>;
    now?: () => number;
  },
  opts: { pageSize?: number; concurrency?: number; budgetMs?: number } = {},
): Promise<SettledScanResult> {
  const { pageSize = SETTLED_PAGE_SIZE, concurrency = SETTLED_CONCURRENCY, budgetMs = SETTLED_BUDGET_MS } = opts;
  const now = deps.now ?? Date.now;
  const deadline = now() + budgetMs;
  const out: SettledScanResult = { scanned: 0, outcomes: {}, errors: [], left: 0 };
  let cursor: SettledCursor = null;
  for (;;) {
    const page = await deps.fetchPage(cursor, pageSize);
    for (let i = 0; i < page.length; i += concurrency) {
      if (now() >= deadline) {
        out.left = await deps.countFrom(cursor);
        return out;
      }
      const batch = page.slice(i, i + concurrency);
      await Promise.all(
        batch.map(async (job) => {
          try {
            const o = await deps.process(job);
            out.outcomes[o] = (out.outcomes[o] ?? 0) + 1;
          } catch (e) {
            out.errors.push(`settled job ${job.id}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }),
      );
      out.scanned += batch.length;
      const last = batch[batch.length - 1];
      cursor = { updatedAt: last.updatedAt, id: last.id };
    }
    if (page.length < pageSize) return out;
  }
}

/**
 * Past the lookback with no refund: one last confirm attempt, then mark the job unresolved so the
 * user and admins are no longer promised an automatic refund.
 */
export async function expireSettledJob(
  ops: SettledFailureOps,
  markUnresolved: (job: { id: string; profileId: string }) => Promise<void>,
  job: { id: string; profileId: string; costCredits: number },
): Promise<"refunded" | "already_refunded" | "unresolved"> {
  const outcome = await reconcileSettledProviderFailure(ops, job);
  if (outcome !== "skipped") return outcome;
  await markUnresolved(job);
  return "unresolved";
}

export type SettledFailureOps = {
  /** Sum of succeeded refunds for the job (a batch partial refund counts; the remainder is what is still held). */
  refundedAmount: (jobId: string) => Promise<number>;
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
): Promise<"refunded" | "already_refunded" | "skipped"> {
  const spent = await ops.spendAmount(job.id);
  const total = spent > 0 ? spent : job.costCredits;
  const refunded = await ops.refundedAmount(job.id);
  // A settled-failed job delivered nothing, so what a batch partial refund left is the ambiguous remainder.
  const amount = total - refunded;
  if (amount <= 0) return "already_refunded";
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
    idempotencyKey: refunded > 0 ? `${photoRefundIdempotencyKey(job.id)}:remainder` : photoRefundIdempotencyKey(job.id),
    jobId: job.id,
    description: "Refund after provider-confirmed generation failure (reconcile cron)",
    metadata: { reason: "generation_failed", reconciledAt: new Date().toISOString() },
  });
  return "refunded";
}
