import {
  classifyProviderSubmitError,
  parseSubmissionFenceSnapshot,
  resolveSubmissionFenceDecision,
  SUBMISSION_PENDING_TIMEOUT_MS,
} from "./submission-fence-pure";

export function submissionFenceSelfCheck(): void {
  const fresh = parseSubmissionFenceSnapshot({
    action: "reserved",
    submissionId: "sub-1",
    state: "reserved",
    predictionId: null,
    reservedAt: "2026-08-14T01:00:00.000Z",
  });
  if (resolveSubmissionFenceDecision(fresh, Date.parse("2026-08-14T01:00:01.000Z")).kind !== "submit") {
    throw new Error("fresh reservation must submit");
  }

  const existingSubmitted = parseSubmissionFenceSnapshot({
    action: "existing",
    submissionId: "sub-2",
    state: "submitted",
    predictionId: null,
    reservedAt: "2026-08-14T01:00:00.000Z",
  });
  const waitDecision = resolveSubmissionFenceDecision(
    existingSubmitted,
    Date.parse("2026-08-14T01:01:00.000Z"),
  );
  if (waitDecision.kind !== "wait" || waitDecision.reason !== "awaiting_webhook") {
    throw new Error("submitted fence without prediction must wait");
  }

  const reuse = parseSubmissionFenceSnapshot({
    action: "existing",
    submissionId: "sub-3",
    state: "submitted",
    predictionId: "pred-1",
    reservedAt: "2026-08-14T01:00:00.000Z",
  });
  if (resolveSubmissionFenceDecision(reuse, Date.parse("2026-08-14T01:01:00.000Z")).kind !== "reuse") {
    throw new Error("fence with prediction must reuse");
  }

  const submittingReplay = parseSubmissionFenceSnapshot({
    action: "existing",
    submissionId: "sub-submitting",
    state: "submitting",
    predictionId: null,
    reservedAt: "2026-08-14T01:00:00.000Z",
  });
  const submittingDecision = resolveSubmissionFenceDecision(
    submittingReplay,
    Date.parse("2026-08-14T01:00:30.000Z"),
  );
  if (submittingDecision.kind !== "wait" || submittingDecision.reason !== "pending_submission") {
    throw new Error("submitting fence replay must wait, never submit");
  }

  const stale = parseSubmissionFenceSnapshot({
    action: "existing",
    submissionId: "sub-4",
    state: "reserved",
    predictionId: null,
    reservedAt: "2026-08-14T00:00:00.000Z",
  });
  if (
    resolveSubmissionFenceDecision(stale, Date.parse("2026-08-14T01:00:00.000Z")).kind !==
    "timed_out"
  ) {
    throw new Error("stale pending fence must time out");
  }

  if (SUBMISSION_PENDING_TIMEOUT_MS !== 15 * 60 * 1000) {
    throw new Error("submission pending timeout must be 15 minutes");
  }

  if (classifyProviderSubmitError("429 Too Many Requests") !== "rate_limit") {
    throw new Error("429 must classify as rate_limit");
  }
  if (classifyProviderSubmitError("fetch failed ECONNRESET") !== "ambiguous") {
    throw new Error("network reset must classify as ambiguous");
  }
  if (classifyProviderSubmitError("422 invalid input") !== "definite") {
    throw new Error("422 must classify as definite");
  }
}

if (process.argv[1]?.includes("submission-fence-self-check")) {
  submissionFenceSelfCheck();
  console.log("submission-fence self-check ok");
}
