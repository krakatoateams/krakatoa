export const SUBMISSION_FENCE_STATES = [
  "reserved",
  "submitting",
  "submitted",
  "completed",
  "failed",
  "timed_out",
] as const;

export type SubmissionFenceState = (typeof SUBMISSION_FENCE_STATES)[number];

/** ponytail: bounded wait before terminal fail/refund when webhook/poll cannot recover. */
export const SUBMISSION_PENDING_TIMEOUT_MS = 15 * 60 * 1000;

export type SubmissionFenceSnapshot = {
  action: "reserved" | "existing";
  submissionId: string;
  state: SubmissionFenceState;
  predictionId: string | null;
  reservedAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  errorJson: Record<string, unknown> | null;
};

export type SubmissionFenceDecision =
  | { kind: "submit"; submissionId: string }
  | { kind: "wait"; submissionId: string; reason: "pending_submission" | "awaiting_webhook" }
  | { kind: "reuse"; submissionId: string; predictionId: string }
  | { kind: "terminal_failed"; submissionId: string; errorJson: Record<string, unknown> | null }
  | { kind: "timed_out"; submissionId: string };

export function parseSubmissionFenceSnapshot(row: Record<string, unknown>): SubmissionFenceSnapshot {
  const action = row.action === "existing" ? "existing" : "reserved";
  const state = String(row.state ?? "reserved") as SubmissionFenceState;
  if (!SUBMISSION_FENCE_STATES.includes(state)) {
    throw new Error("parseSubmissionFenceSnapshot: invalid state");
  }
  const submissionId = String(row.submissionId ?? "");
  if (!submissionId) throw new Error("parseSubmissionFenceSnapshot: missing submissionId");
  return {
    action,
    submissionId,
    state,
    predictionId: typeof row.predictionId === "string" ? row.predictionId : null,
    reservedAt: String(row.reservedAt ?? new Date(0).toISOString()),
    submittedAt: typeof row.submittedAt === "string" ? row.submittedAt : null,
    completedAt: typeof row.completedAt === "string" ? row.completedAt : null,
    errorJson:
      row.errorJson && typeof row.errorJson === "object"
        ? (row.errorJson as Record<string, unknown>)
        : null,
  };
}

export function resolveSubmissionFenceDecision(
  snapshot: SubmissionFenceSnapshot,
  nowMs: number = Date.now(),
  timeoutMs: number = SUBMISSION_PENDING_TIMEOUT_MS,
): SubmissionFenceDecision {
  const ageMs = nowMs - Date.parse(snapshot.reservedAt);
  const timedOut = Number.isFinite(ageMs) && ageMs >= timeoutMs;

  if (snapshot.state === "completed") {
    if (!snapshot.predictionId) {
      throw new Error("completed fence must carry predictionId");
    }
    return { kind: "reuse", submissionId: snapshot.submissionId, predictionId: snapshot.predictionId };
  }

  if (snapshot.state === "failed") {
    return {
      kind: "terminal_failed",
      submissionId: snapshot.submissionId,
      errorJson: snapshot.errorJson,
    };
  }

  if (snapshot.state === "timed_out" || timedOut) {
    return { kind: "timed_out", submissionId: snapshot.submissionId };
  }

  if (snapshot.predictionId) {
    return {
      kind: "reuse",
      submissionId: snapshot.submissionId,
      predictionId: snapshot.predictionId,
    };
  }

  if (snapshot.state === "submitting") {
    return {
      kind: "wait",
      submissionId: snapshot.submissionId,
      reason: "pending_submission",
    };
  }

  if (snapshot.action === "reserved" && snapshot.state === "reserved") {
    return { kind: "submit", submissionId: snapshot.submissionId };
  }

  return {
    kind: "wait",
    submissionId: snapshot.submissionId,
    reason: snapshot.state === "submitted" ? "awaiting_webhook" : "pending_submission",
  };
}

export type ProviderSubmissionClaimResult = {
  claimed: boolean;
  submissionId?: string;
  state?: SubmissionFenceState;
  predictionId?: string | null;
  reason?: string;
};

export function parseProviderSubmissionClaimResult(
  row: Record<string, unknown>,
): ProviderSubmissionClaimResult {
  return {
    claimed: row.claimed === true,
    submissionId: typeof row.submissionId === "string" ? row.submissionId : undefined,
    state:
      typeof row.state === "string" && SUBMISSION_FENCE_STATES.includes(row.state as SubmissionFenceState)
        ? (row.state as SubmissionFenceState)
        : undefined,
    predictionId:
      typeof row.predictionId === "string"
        ? row.predictionId
        : row.predictionId === null
          ? null
          : undefined,
    reason: typeof row.reason === "string" ? row.reason : undefined,
  };
}

export type SubmitPredictionStepResult =
  | { outcome: "prediction"; predictionId: string }
  | { outcome: "wait" };

export type SubmitErrorClass = "definite" | "ambiguous" | "rate_limit";

export function classifyProviderSubmitError(message: string): SubmitErrorClass {
  const lower = message.toLowerCase();
  if (lower.includes("429") || lower.includes("rate limit")) return "rate_limit";
  if (
    /\b(500|502|503|504|network|timeout|econnreset|etimedout|socket|fetch failed)\b/i.test(
      message,
    )
  ) {
    return "ambiguous";
  }
  if (/\b(400|401|403|404|422)\b/.test(message)) return "definite";
  return "ambiguous";
}
