import {
  collectRecentPredictions,
  findUniquePredictionByWebhook,
  PROVIDER_SUBMISSION_STATE_UNKNOWN,
  shouldRefundOnUnknownSubmissionTimeout,
  shouldRunSubmissionListRecovery,
  submissionListRecoveryLoopsPerInterval,
  SUBMISSION_FENCE_POLL_SLEEP_MS,
  SUBMISSION_LIST_RECOVERY_INTERVAL_MS,
  SUBMISSION_LIST_RECOVERY_MAX_PAGES,
  unknownSubmissionTimeoutErrorJson,
  type PredictionListPage,
} from "./submission-recovery-pure";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

export async function submissionRecoverySelfCheck(): Promise<void> {
  const every = submissionListRecoveryLoopsPerInterval();
  assert(every === 6, "30s list recovery must run every 6 loops at 5s poll sleep");
  assert(
    !shouldRunSubmissionListRecovery(5),
    "list recovery must not run before 30s cadence",
  );
  assert(
    shouldRunSubmissionListRecovery(6),
    "list recovery must run on 30s cadence boundary",
  );
  assert(
    !shouldRunSubmissionListRecovery(7),
    "list recovery must not run off-cadence",
  );
  assert(
    shouldRunSubmissionListRecovery(12),
    "list recovery must repeat every 30s",
  );

  assert(
    SUBMISSION_LIST_RECOVERY_MAX_PAGES === 3,
    "list recovery page ceiling must stay at 3",
  );
  assert(
    SUBMISSION_LIST_RECOVERY_INTERVAL_MS === 30_000,
    "list recovery interval must stay at 30s",
  );
  assert(
    SUBMISSION_FENCE_POLL_SLEEP_MS === 5_000,
    "fence poll sleep must stay at 5s",
  );

  const pages: Record<string, PredictionListPage> = {
    "": { results: [{ id: "pred-1" }, { webhook: "no-id" }], next: "cursor-2" },
    "cursor-2": { results: [{ id: "pred-2" }], next: "cursor-3" },
    "cursor-3": { results: [{ id: "pred-3" }], next: "cursor-4" },
    "cursor-4": { results: [{ id: "pred-4" }], next: null },
  };
  const visited: Array<string | null> = [];
  const walked = await collectRecentPredictions(async (cursor) => {
    visited.push(cursor);
    return pages[cursor ?? ""];
  });
  assert(
    walked.map((row) => row.id).join(",") === "pred-1,pred-2,pred-3",
    "list recovery must follow every cursor up to the page ceiling",
  );
  assert(
    visited.length === SUBMISSION_LIST_RECOVERY_MAX_PAGES && visited[0] === null,
    "list recovery must request exactly the ceiling of pages, starting uncursored",
  );

  const singlePage = await collectRecentPredictions(async () => ({
    results: [{ id: "only" }],
    next: null,
  }));
  assert(singlePage.length === 1, "list recovery must stop when the cursor runs out");

  const webhook = "https://example.com/api/webhooks/replicate/sub-1?t=v1.abc";
  assert(
    findUniquePredictionByWebhook(
      [
        { id: "pred-a", webhook: "https://other" },
        { id: "pred-b", webhook },
      ],
      webhook,
    ) === "pred-b",
    "exact webhook match must recover unique prediction",
  );
  assert(
    findUniquePredictionByWebhook([], webhook) === null,
    "no matches must not recover",
  );
  assert(
    findUniquePredictionByWebhook(
      [
        { id: "pred-a", webhook },
        { id: "pred-b", webhook },
      ],
      webhook,
    ) === null,
    "duplicate webhook matches must not recover",
  );

  assert(
    shouldRefundOnUnknownSubmissionTimeout() === false,
    "unknown submission timeout must not auto-refund",
  );
  const err = unknownSubmissionTimeoutErrorJson();
  assert(
    err.code === PROVIDER_SUBMISSION_STATE_UNKNOWN,
    "unknown timeout error must carry explicit code",
  );
}

if (process.argv[1]?.includes("submission-recovery-self-check")) {
  submissionRecoverySelfCheck().then(
    () => console.log("submission-recovery self-check ok"),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
