import { createHash } from "crypto";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * Generation request-level idempotency (Double-Charge Protection v1).
 *
 * Each generation route records a row in `generation_requests` BEFORE creating a
 * job, spending credits, or calling any provider. The unique(profile_id,
 * idempotency_key) constraint is the race-safe dedupe primitive. This module
 * NEVER calls providers and contains NO payment logic — it only reads/writes the
 * generation_requests table via the service-role client and enforces profile
 * ownership in every query.
 *
 * Keep aligned with supabase/migrations/008_generation_idempotency.sql.
 */

const TABLE = "generation_requests";

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
  | { action: "conflict" };

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (
    error.message.includes("generation_requests") &&
    (error.message.includes("schema cache") || error.message.includes("does not exist"))
  ) {
    throw new Error(
      "Database table generation_requests is missing. Run: npm run db:setup — or apply supabase/migrations/008_generation_idempotency.sql."
    );
  }
  throw new Error(error.message || fallback);
}

// ---------------------------------------------------------------------------
// Key + hashing utilities (pure)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Data access
// ---------------------------------------------------------------------------

export async function getExistingGenerationRequest(
  profileId: string,
  idempotencyKey: string
): Promise<GenerationRequestRow | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  handleError(error, "Failed to read generation request.");
  return (data as GenerationRequestRow | null) ?? null;
}

/**
 * Insert-first idempotency gate. Returns an action the route must honor BEFORE
 * doing any job/spend/provider work:
 *   - proceed      : fresh row inserted, or a failed/stale row taken over.
 *   - replay       : a prior attempt already succeeded; return its stored response.
 *   - in_progress  : a prior attempt is still running (fresh lock) or a takeover
 *                    race was lost.
 *   - conflict     : the key was reused with a different request payload.
 */
export async function beginGenerationRequest(params: {
  profileId: string;
  idempotencyKey: string;
  routeKey: string;
  toolKey: string;
  requestHash: string;
}): Promise<BeginResult> {
  const lockedUntil = new Date(Date.now() + LOCK_TTL_MS).toISOString();

  // 1) Insert-first. unique(profile_id, idempotency_key) admits exactly one
  //    concurrent insert; everyone else hits the 23505 unique violation.
  const { data: inserted, error: insertError } = await supabaseServer
    .from(TABLE)
    .insert({
      profile_id: params.profileId,
      idempotency_key: params.idempotencyKey,
      route_key: params.routeKey,
      tool_key: params.toolKey,
      request_hash: params.requestHash,
      status: "started",
      locked_until: lockedUntil,
    })
    .select("id")
    .single();

  if (!insertError && inserted) {
    return { action: "proceed", id: (inserted as { id: string }).id };
  }

  // A non-unique-violation error is a real failure.
  if (insertError && (insertError as { code?: string }).code !== "23505") {
    handleError(insertError, "Failed to begin generation request.");
  }

  // 2) Unique violation: a row already exists for this (profile, key).
  const existing = await getExistingGenerationRequest(params.profileId, params.idempotencyKey);
  if (!existing) {
    // Row vanished between insert and select (cascade delete). Treat conservatively.
    return { action: "in_progress" };
  }

  if (existing.request_hash !== params.requestHash) {
    return { action: "conflict" };
  }

  if (existing.status === "succeeded" && existing.response_json) {
    return { action: "replay", response: existing.response_json };
  }

  const lockFresh =
    existing.status === "started" &&
    existing.locked_until !== null &&
    new Date(existing.locked_until).getTime() > Date.now();

  if (lockFresh) {
    return { action: "in_progress" };
  }

  // 3) Failed OR stale-started: race-safe optimistic takeover. We match the
  //    exact `updated_at` we observed; any competing takeover/finish bumps
  //    updated_at (via the trigger), so the loser updates 0 rows -> in_progress.
  const { data: takeover, error: takeoverError } = await supabaseServer
    .from(TABLE)
    .update({
      status: "started",
      request_hash: params.requestHash,
      route_key: params.routeKey,
      tool_key: params.toolKey,
      locked_until: lockedUntil,
      error_json: null,
      response_json: null,
      job_id: null,
      asset_id: null,
      // A re-run of the same key must not inherit a stale cancel flag.
      cancel_requested: false,
    })
    .eq("id", existing.id)
    .eq("updated_at", existing.updated_at)
    .select("id")
    .maybeSingle();

  handleError(takeoverError, "Failed to take over generation request.");
  if (takeover) {
    return { action: "proceed", id: (takeover as { id: string }).id };
  }
  return { action: "in_progress" };
}

export async function finishGenerationRequestSuccess(params: {
  id: string;
  jobId?: string | null;
  assetId?: string | null;
  responseJson: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseServer
    .from(TABLE)
    .update({
      status: "succeeded",
      job_id: params.jobId ?? null,
      asset_id: params.assetId ?? null,
      response_json: params.responseJson,
      error_json: null,
      locked_until: null,
    })
    .eq("id", params.id);

  handleError(error, "Failed to finalize generation request.");
}

export async function finishGenerationRequestFailure(params: {
  id: string;
  jobId?: string | null;
  errorJson: Record<string, unknown>;
}): Promise<void> {
  const { error } = await supabaseServer
    .from(TABLE)
    .update({
      status: "failed",
      job_id: params.jobId ?? null,
      error_json: params.errorJson,
      locked_until: null,
    })
    .eq("id", params.id);

  handleError(error, "Failed to record generation request failure.");
}
