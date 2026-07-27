import { createHash } from "crypto";

/** Lock window for an in-flight attempt. Must exceed the routes' maxDuration
 *  (300s) with buffer, so a still-running attempt is never treated as stale. */
export const LOCK_TTL_MS = 15 * 60 * 1000;
export const MIN_KEY_LEN = 8;
export const MAX_KEY_LEN = 200;

export type GenerationRequestStatus = "started" | "succeeded" | "failed";

export type GenerationRequestRow = {
  id: string;
  profile_id: string;
  idempotency_key: string;
  tool_key: string;
  route_key: string;
  request_hash: string;
  status: GenerationRequestStatus;
  job_id: string | null;
  asset_id: string | null;
  response_json: Record<string, unknown> | null;
  error_json: Record<string, unknown> | null;
  locked_until: string | null;
  cancel_requested?: boolean;
  created_at: string;
  updated_at: string;
};

export type BeginResult =
  | { action: "proceed"; id: string }
  | { action: "replay"; response: Record<string, unknown> }
  | { action: "in_progress" }
  | { action: "conflict" }
  | { action: "recoverable"; id: string; jobId: string; errorJson: Record<string, unknown> };

export const PIPELINE_RECOVERABLE_CODE = "PIPELINE_RECOVERABLE";

export function isPipelineRecoverableErrorJson(
  errorJson: Record<string, unknown> | null | undefined,
): boolean {
  return errorJson?.code === PIPELINE_RECOVERABLE_CODE;
}

export function buildRecoverableGenerationJson(params: {
  jobId: string;
  message?: string;
}): Record<string, unknown> {
  return {
    recoverable: true,
    jobId: params.jobId,
    error: params.message ?? "Generation paused for recovery.",
    code: PIPELINE_RECOVERABLE_CODE,
    refunded: false,
  };
}

/** Build idempotency replay body from a succeeded job's output snapshot. */
export function jobOutputToGenerationResponse(
  output: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!output) return null;
  const storagePath =
    typeof output.storagePath === "string" ? output.storagePath : undefined;
  const videoUrl = typeof output.videoUrl === "string" ? output.videoUrl : undefined;
  if (!storagePath && !videoUrl) return null;
  const response: Record<string, unknown> = {};
  if (videoUrl) response.videoUrl = videoUrl;
  if (storagePath) response.storagePath = storagePath;
  if (output.historyItem !== undefined && output.historyItem !== null) {
    response.historyItem = output.historyItem;
  }
  if (typeof output.savedToCloud === "boolean") {
    response.savedToCloud = output.savedToCloud;
  }
  return response;
}

export type LinkedJobRow = {
  status: string;
  output: Record<string, unknown> | null;
  error: Record<string, unknown> | null;
};

/**
 * Pure linked-job gate for beginGenerationRequest (no DB).
 * Blocks takeover when the job is recoverable or replays when already succeeded.
 */
export function resolveLinkedJobBeginAction(
  existing: Pick<GenerationRequestRow, "id" | "job_id" | "error_json">,
  job: LinkedJobRow | null | undefined,
): BeginResult | null {
  if (!existing.job_id || !job) return null;

  if (job.status === "succeeded") {
    const response = jobOutputToGenerationResponse(job.output);
    if (response) {
      return { action: "replay", response: { ...response, resumed: true } };
    }
  }

  if (job.status === "recoverable") {
    const storedError = existing.error_json as Record<string, unknown> | null;
    const errorJson =
      storedError && isPipelineRecoverableErrorJson(storedError)
        ? storedError
        : {
            code: PIPELINE_RECOVERABLE_CODE,
            message:
              typeof job.error?.message === "string"
                ? job.error.message
                : "Generation paused for recovery.",
          };
    return {
      action: "recoverable",
      id: existing.id,
      jobId: existing.job_id,
      errorJson,
    };
  }

  return null;
}

/** Read the `Idempotency-Key` HTTP header (trimmed). Returns null when absent/blank. */
export function readIdempotencyKey(req: Request): string | null {
  const raw = req.headers.get("Idempotency-Key");
  if (!raw) return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Validate the opaque key shape (length bounds only; any opaque string/UUID is fine). */
export function isValidIdempotencyKey(key: string | null | undefined): key is string {
  if (typeof key !== "string") return false;
  const k = key.trim();
  return k.length >= MIN_KEY_LEN && k.length <= MAX_KEY_LEN;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(input).sort()) {
      out[k] = sortValue(input[k]);
    }
    return out;
  }
  return value;
}

/** Deterministic JSON with recursively sorted keys, so equivalent payloads match. */
export function normalizeRequestForHash(obj: unknown): string {
  return JSON.stringify(sortValue(obj));
}

/** SHA-256 (hex) of the normalized request. Hash client inputs only — never the
 *  idempotency key, resolved pricing, or resolved model config. */
export function computeRequestHash(obj: unknown): string {
  return createHash("sha256").update(normalizeRequestForHash(obj)).digest("hex");
}
