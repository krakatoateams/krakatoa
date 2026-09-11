/** Pure studio generation submit flow — testable without React. */

import {
  STUDIO_GENERATION_ERROR_FALLBACK,
  classifyStudioGenerationResponse,
  parseStudioGenerationResponse,
  type StudioGenerationOutcome,
  type StudioGenerationResponseData,
} from "./studio-generation-response";

export type StudioGenerationSubmitEffects = {
  clearError: () => void;
  refetchCredits: () => void;
  refreshHistory: () => void;
  openPreviewFromResponse: (data: unknown) => void | Promise<void>;
};

export function guardStudioGenerationSubmitEffects(
  isMounted: () => boolean,
  effects: StudioGenerationSubmitEffects,
): StudioGenerationSubmitEffects {
  return {
    clearError() {
      if (isMounted()) effects.clearError();
    },
    refetchCredits() {
      if (isMounted()) effects.refetchCredits();
    },
    refreshHistory() {
      if (isMounted()) effects.refreshHistory();
    },
    openPreviewFromResponse(data) {
      if (isMounted()) return effects.openPreviewFromResponse(data);
    },
  };
}

export type StudioGenerationSubmitAttempt = {
  settle: (succeeded: boolean) => void;
};

export type StudioGenerationSubmitLock = {
  acquire: () => boolean;
  release: () => void;
};

export function createStudioGenerationSubmitLock(): StudioGenerationSubmitLock {
  let locked = false;
  return {
    acquire() {
      if (locked) return false;
      locked = true;
      return true;
    },
    release() {
      locked = false;
    },
  };
}

export type StudioGenerationPendingErrorCode =
  | "STUDIO_GENERATION_AWAIT_COMPLETION_REQUIRED"
  | "STUDIO_GENERATION_COMPLETION_NOT_TERMINAL";

export class StudioGenerationPendingError extends Error {
  constructor(
    readonly code: StudioGenerationPendingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "StudioGenerationPendingError";
  }
}

export function isStudioGenerationPendingError(
  error: unknown,
): error is StudioGenerationPendingError {
  return error instanceof StudioGenerationPendingError;
}

export type StudioGenerationCompletion = {
  status: number;
  data: StudioGenerationResponseData;
};

export type StudioGenerationSubmitOptions = {
  fallbackCost?: number;
  errorFallback?: string;
  /** Fallback only for non-Error exceptions thrown by transport or callbacks. */
  unexpectedErrorFallback?: string;
  /** HTTP 202 / processing — poll until an explicit terminal status and payload. */
  awaitCompletion?: (
    initialData: StudioGenerationResponseData,
    idempotencyKey: string,
  ) => Promise<StudioGenerationCompletion>;
  previewData?: (data: StudioGenerationResponseData) => unknown;
  onSuccess?: (data: StudioGenerationResponseData) => void | Promise<void>;
  /** Override recoverable banner copy (e.g. Reels stitching failure). */
  recoverableMessage?: string | ((data: StudioGenerationResponseData) => string);
  /** Skip preview/history/credits success side-effects (e.g. storyboard import modal). */
  skipSuccessEffects?: boolean;
};

export type StudioGenerationSubmitResult =
  | { kind: "noop" }
  | { kind: "cancelled" }
  | { kind: "recoverable"; jobId: string; message: string }
  | { kind: "error"; message: string }
  | { kind: "success"; data: StudioGenerationResponseData };

export function isStudioGenerationCancelledError(err: unknown): boolean {
  return !!(
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: string }).code === "GENERATION_CANCELLED"
  );
}

function recoverableMessageOf(
  outcome: Extract<StudioGenerationOutcome, { kind: "recoverable" }>,
  data: StudioGenerationResponseData,
  override?: StudioGenerationSubmitOptions["recoverableMessage"],
): string {
  if (typeof override === "function") return override(data);
  if (typeof override === "string") return override;
  return outcome.message;
}

async function applyTerminalSuccess(
  data: StudioGenerationResponseData,
  attempt: StudioGenerationSubmitAttempt,
  effects: StudioGenerationSubmitEffects,
  options: StudioGenerationSubmitOptions,
): Promise<StudioGenerationSubmitResult> {
  attempt.settle(true);
  if (!options.skipSuccessEffects) {
    const previewPayload = options.previewData ? options.previewData(data) : data;
    void Promise.resolve(effects.openPreviewFromResponse(previewPayload)).catch(() => {});
    effects.refreshHistory();
    effects.refetchCredits();
  }
  await options.onSuccess?.(data);
  return { kind: "success", data };
}

/** Classify + settle a parsed generation response (post-fetch, pre-success side-effects). */
export async function applyStudioGenerationOutcome(
  status: number,
  data: StudioGenerationResponseData,
  attempt: StudioGenerationSubmitAttempt,
  effects: StudioGenerationSubmitEffects,
  options: StudioGenerationSubmitOptions = {},
): Promise<StudioGenerationSubmitResult> {
  const outcome = classifyStudioGenerationResponse(status, data, {
    fallbackCost: options.fallbackCost,
    errorFallback: options.errorFallback,
  });

  switch (outcome.kind) {
    case "success":
      return applyTerminalSuccess(data, attempt, effects, options);
    case "cancelled":
      attempt.settle(false);
      effects.clearError();
      effects.refetchCredits();
      return { kind: "cancelled" };
    case "recoverable":
      attempt.settle(false);
      return {
        kind: "recoverable",
        jobId: outcome.jobId,
        message: recoverableMessageOf(outcome, data, options.recoverableMessage),
      };
    case "insufficient_credits":
    case "in_progress":
    case "idempotency_conflict":
    case "idempotency_key_required":
    case "error":
      attempt.settle(false);
      return { kind: "error", message: outcome.message };
    default:
      attempt.settle(false);
      return { kind: "error", message: STUDIO_GENERATION_ERROR_FALLBACK };
  }
}

/** End-to-end fetch handler for one studio generation attempt. */
export async function runStudioGenerationSubmit(
  response: Response,
  idempotencyKey: string,
  attempt: StudioGenerationSubmitAttempt,
  effects: StudioGenerationSubmitEffects,
  options: StudioGenerationSubmitOptions = {},
): Promise<StudioGenerationSubmitResult> {
  const data = await parseStudioGenerationResponse(response);
  const status = response.status;
  const isDeferred = status === 202 || data.status === "processing";

  if (response.ok && isDeferred) {
    if (options.awaitCompletion) {
      const completed = await options.awaitCompletion(data, idempotencyKey);
      if (
        completed.status === 202 ||
        completed.data.status === "processing"
      ) {
        throw new StudioGenerationPendingError(
          "STUDIO_GENERATION_COMPLETION_NOT_TERMINAL",
          "Completion polling returned before generation reached a terminal state.",
        );
      }
      return applyStudioGenerationOutcome(
        completed.status,
        completed.data,
        attempt,
        effects,
        options,
      );
    }
    throw new StudioGenerationPendingError(
      "STUDIO_GENERATION_AWAIT_COMPLETION_REQUIRED",
      "Generation is still processing, but this client has no completion poller.",
    );
  }

  return applyStudioGenerationOutcome(status, data, attempt, effects, options);
}

export type StudioGenerationResumeResult =
  | { kind: "success"; data: StudioGenerationResponseData }
  | { kind: "still_recoverable"; message: string }
  | { kind: "error"; message: string };

export async function runStudioGenerationResume(
  response: Response,
  effects: StudioGenerationSubmitEffects,
  stillFailingMessage = "Upload still failing. Try again in a moment.",
): Promise<StudioGenerationResumeResult> {
  const data = await parseStudioGenerationResponse(response);
  if (!response.ok) {
    if (data.code === "PIPELINE_RECOVERABLE") {
      return { kind: "still_recoverable", message: data.error || stillFailingMessage };
    }
    return { kind: "error", message: data.error || "Resume failed" };
  }
  void Promise.resolve(effects.openPreviewFromResponse(data)).catch(() => {});
  effects.refreshHistory();
  effects.refetchCredits();
  return { kind: "success", data };
}
