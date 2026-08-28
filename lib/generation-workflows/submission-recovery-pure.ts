/** Explicit terminal when submit ambiguity cannot be resolved within the fence TTL. */
export const PROVIDER_SUBMISSION_STATE_UNKNOWN = "PROVIDER_SUBMISSION_STATE_UNKNOWN";

/** General fence wait loop sleep (webhook / snapshot poll). */
export const SUBMISSION_FENCE_POLL_SLEEP_MS = 5_000;

/** Bounded cadence for Replicate predictions.list recovery while fence is submitting. */
export const SUBMISSION_LIST_RECOVERY_INTERVAL_MS = 30_000;

/** ponytail: 3 pages × 100 results/page = 300 most-recent predictions; widen if ambiguous-submit volume grows. */
export const SUBMISSION_LIST_RECOVERY_MAX_PAGES = 3;

export type ListPredictionWebhookRow = {
  id: string;
  webhook?: string | null;
};

export type PredictionListPage = {
  next?: string | null;
  results?: Array<{ id?: string; webhook?: string | null }>;
};

/**
 * Walk Replicate's prediction list up to the page ceiling.
 * `fetchPage` receives the cursor of the page to load, or null for the first one.
 */
export async function collectRecentPredictions(
  fetchPage: (cursor: string | null) => Promise<PredictionListPage>,
  maxPages: number = SUBMISSION_LIST_RECOVERY_MAX_PAGES,
): Promise<ListPredictionWebhookRow[]> {
  const rows: ListPredictionWebhookRow[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const { results, next } = await fetchPage(cursor);
    for (const row of results ?? []) {
      if (typeof row.id === "string") rows.push({ id: row.id, webhook: row.webhook });
    }
    cursor = next ?? null;
    if (!cursor) break;
  }

  return rows;
}

export class ProviderSubmissionStateUnknownError extends Error {
  readonly code = PROVIDER_SUBMISSION_STATE_UNKNOWN;

  constructor(
    message = "Provider submission state could not be confirmed after timeout.",
  ) {
    super(message);
    this.name = "ProviderSubmissionStateUnknownError";
  }
}

export function submissionListRecoveryLoopsPerInterval(
  pollSleepMs: number = SUBMISSION_FENCE_POLL_SLEEP_MS,
  listIntervalMs: number = SUBMISSION_LIST_RECOVERY_INTERVAL_MS,
): number {
  return Math.max(1, Math.round(listIntervalMs / pollSleepMs));
}

/** Deterministic cadence: list recovery every ~30s inside the 5s fence wait loop. */
export function shouldRunSubmissionListRecovery(
  waitLoopCount: number,
  pollSleepMs: number = SUBMISSION_FENCE_POLL_SLEEP_MS,
  listIntervalMs: number = SUBMISSION_LIST_RECOVERY_INTERVAL_MS,
): boolean {
  if (waitLoopCount <= 0) return false;
  const every = submissionListRecoveryLoopsPerInterval(pollSleepMs, listIntervalMs);
  return waitLoopCount % every === 0;
}

/** Exact webhook URL match — never fuzzy. Returns null unless exactly one row matches. */
export function findUniquePredictionByWebhook(
  rows: ListPredictionWebhookRow[],
  expectedWebhookUrl: string,
): string | null {
  const matches = new Set(
    rows.filter((row) => row.webhook === expectedWebhookUrl).map((row) => row.id),
  );
  if (matches.size !== 1) return null;
  return matches.values().next().value ?? null;
}

/** Unknown submit state after TTL: conservative no-refund (provider may have billed). */
export function shouldRefundOnUnknownSubmissionTimeout(): boolean {
  return false;
}

export function unknownSubmissionTimeoutErrorJson(): Record<string, unknown> {
  return {
    code: PROVIDER_SUBMISSION_STATE_UNKNOWN,
    message:
      "Provider submission state could not be confirmed after timeout. Credits were not refunded automatically.",
  };
}
