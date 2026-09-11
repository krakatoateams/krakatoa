/** Shared client-side parsing + outcome classification for studio generation fetch responses. */

export type StudioGenerationResponseData = {
  code?: string;
  error?: string;
  message?: string;
  recoverable?: boolean;
  jobId?: string;
  requiredCredits?: number;
  currentBalance?: number;
  [key: string]: unknown;
};

export type StudioGenerationOutcome =
  | { kind: "success"; data: StudioGenerationResponseData }
  | { kind: "cancelled" }
  | { kind: "in_progress"; message: string }
  | { kind: "idempotency_conflict"; message: string }
  | { kind: "idempotency_key_required"; message: string }
  | { kind: "insufficient_credits"; message: string; requiredCredits: number; currentBalance: number }
  | { kind: "recoverable"; jobId: string; message: string }
  | { kind: "error"; message: string };

export type ClassifyStudioGenerationOptions = {
  /** Used when the API omits requiredCredits (402). */
  fallbackCost?: number;
  /** Used when the API omits error (generic failure). */
  errorFallback?: string;
};

/** Exact copy of video/page.tsx timeout copy for empty or non-JSON error bodies. */
export const STUDIO_GENERATION_TIMEOUT_MESSAGE =
  "The request timed out, but the generation may still be finishing — check your history in a moment.";

/** Exact copy of video/page.tsx for OK responses that are not JSON. */
export const STUDIO_GENERATION_UNEXPECTED_OK_MESSAGE = "Unexpected response from server.";

export const STUDIO_GENERATION_IN_PROGRESS_MESSAGE =
  "Generation already in progress, please wait.";

export const STUDIO_GENERATION_IDEMPOTENCY_CONFLICT_FALLBACK =
  "This request conflicts with a previous one.";

export const STUDIO_GENERATION_IDEMPOTENCY_KEY_REQUIRED_FALLBACK =
  "Missing idempotency key. Please retry.";

export const STUDIO_GENERATION_RECOVERABLE_FALLBACK =
  "The provider finished but upload or editing failed. Credits stay on hold — tap Try again.";

export const STUDIO_GENERATION_ERROR_FALLBACK = "Generation failed";

/** Synchronous body parse — mirrors video `parseJsonResponse` without reading the stream. */
export function parseStudioGenerationResponseText(
  text: string,
  responseOk: boolean,
): StudioGenerationResponseData {
  if (!text) {
    if (responseOk) return {};
    throw new Error(STUDIO_GENERATION_TIMEOUT_MESSAGE);
  }
  try {
    return JSON.parse(text) as StudioGenerationResponseData;
  } catch {
    throw new Error(
      responseOk ? STUDIO_GENERATION_UNEXPECTED_OK_MESSAGE : STUDIO_GENERATION_TIMEOUT_MESSAGE,
    );
  }
}

/** Async parse — mirrors video `parseJsonResponse`. */
export async function parseStudioGenerationResponse(
  response: Response,
): Promise<StudioGenerationResponseData> {
  const text = await response.text();
  return parseStudioGenerationResponseText(text, response.ok);
}

/** Exact copy of video/page.tsx `describeIdempotencyError`. */
export function describeStudioIdempotencyError(
  status: number,
  data: { code?: string; error?: string },
): string | null {
  if (status === 409 && data?.code === "GENERATION_IN_PROGRESS") {
    return STUDIO_GENERATION_IN_PROGRESS_MESSAGE;
  }
  if (status === 409 && data?.code === "IDEMPOTENCY_CONFLICT") {
    return data?.error || STUDIO_GENERATION_IDEMPOTENCY_CONFLICT_FALLBACK;
  }
  if (status === 400 && data?.code === "IDEMPOTENCY_KEY_REQUIRED") {
    return data?.error || STUDIO_GENERATION_IDEMPOTENCY_KEY_REQUIRED_FALLBACK;
  }
  return null;
}

/** Exact copy of video/page.tsx `recoverableGenerationMessage`. */
export function recoverableStudioGenerationMessage(data: { error?: string }): string {
  return data.error || STUDIO_GENERATION_RECOVERABLE_FALLBACK;
}

export function insufficientCreditsMessage(
  data: { requiredCredits?: number; currentBalance?: number },
  fallbackCost = 0,
): string {
  const requiredCredits = data.requiredCredits ?? fallbackCost;
  const currentBalance = data.currentBalance ?? 0;
  return `Insufficient credits. Required: ${requiredCredits}, current: ${currentBalance}.`;
}

/** 503 + recoverable + jobId (video t2v/i2v/storyboard) or body-level recoverable + jobId (reels). */
export function isRecoverableStudioGenerationResponse(
  _status: number,
  data: { recoverable?: boolean; jobId?: string },
): data is { recoverable: true; jobId: string; error?: string } {
  // ponytail: status ignored — both call sites require recoverable + jobId; 503 is just the usual carrier.
  return !!(data.recoverable && data.jobId);
}

/** Classify an already-parsed generation response. Callers pass `response.ok` via status. */
export function classifyStudioGenerationResponse(
  status: number,
  data: StudioGenerationResponseData,
  options: ClassifyStudioGenerationOptions = {},
): StudioGenerationOutcome {
  if (status === 202 || data.status === "processing") {
    return { kind: "in_progress", message: STUDIO_GENERATION_IN_PROGRESS_MESSAGE };
  }

  if (data.code === "GENERATION_CANCELLED") {
    return { kind: "cancelled" };
  }

  if (status === 402) {
    const requiredCredits = data.requiredCredits ?? options.fallbackCost ?? 0;
    const currentBalance = data.currentBalance ?? 0;
    return {
      kind: "insufficient_credits",
      message: insufficientCreditsMessage(data, options.fallbackCost ?? 0),
      requiredCredits,
      currentBalance,
    };
  }

  if (isRecoverableStudioGenerationResponse(status, data)) {
    return {
      kind: "recoverable",
      jobId: data.jobId,
      message: recoverableStudioGenerationMessage(data),
    };
  }

  if (status === 409 && data.code === "GENERATION_IN_PROGRESS") {
    return {
      kind: "in_progress",
      message: describeStudioIdempotencyError(status, data)!,
    };
  }
  if (status === 409 && data.code === "IDEMPOTENCY_CONFLICT") {
    return {
      kind: "idempotency_conflict",
      message: describeStudioIdempotencyError(status, data)!,
    };
  }
  if (status === 400 && data.code === "IDEMPOTENCY_KEY_REQUIRED") {
    return {
      kind: "idempotency_key_required",
      message: describeStudioIdempotencyError(status, data)!,
    };
  }

  if (status >= 200 && status < 300) {
    return { kind: "success", data };
  }

  const fallback = options.errorFallback ?? STUDIO_GENERATION_ERROR_FALLBACK;
  return {
    kind: "error",
    message: data.error || fallback,
  };
}

/** Parse response text then classify — typical post-fetch path for studio composers. */
export async function characterizeStudioGenerationResponse(
  response: Response,
  options: ClassifyStudioGenerationOptions = {},
): Promise<StudioGenerationOutcome> {
  const data = await parseStudioGenerationResponse(response);
  return classifyStudioGenerationResponse(response.status, data, options);
}
