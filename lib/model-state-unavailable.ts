import { NextResponse } from "next/server";

/**
 * Admin model state (archived / disabled models) could not be read. Callers must fail CLOSED:
 * offer no models and reject generation before any spend or provider call. A table that does not
 * exist at all is a different case (ModelTableMissingError): no admin state can exist, so the
 * shipped code defaults apply.
 */
export const MODEL_STATE_UNAVAILABLE_MESSAGE =
  "Models are temporarily unavailable. Please try again in a moment.";

export class ModelStateUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(MODEL_STATE_UNAVAILABLE_MESSAGE, cause === undefined ? undefined : { cause });
    this.name = "ModelStateUnavailableError";
  }
}

export class ModelTableMissingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelTableMissingError";
  }
}

export function isModelStateUnavailable(e: unknown): e is ModelStateUnavailableError {
  return e instanceof ModelStateUnavailableError;
}

/** Retryable 503 for routes: no job, no spend, no provider call has happened yet. */
export function modelStateUnavailableResponse(): NextResponse {
  return NextResponse.json(
    { error: MODEL_STATE_UNAVAILABLE_MESSAGE, code: "MODEL_STATE_UNAVAILABLE", retryable: true },
    { status: 503, headers: { "Retry-After": "5" } }
  );
}

/**
 * True only when the error code says a table is absent (Postgres 42P01 / PostgREST PGRST205) AND the
 * message names this table. Anything else, including a missing COLUMN (42703 / PGRST204) under schema
 * drift, is an unknown state and fails closed.
 */
export function isTableMissing(error: { message?: string; code?: string } | null, table: string): boolean {
  if (!error || (error.code !== "42P01" && error.code !== "PGRST205")) return false;
  // Whole identifier only: "model_configs" must not match "feature_model_configs".
  const name = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w])${name}($|[^\\w])`).test(error.message ?? "");
}

export const MODEL_STATE_READ_TIMEOUT_MS = 8_000;

/** Rejects when a runtime state read hangs: a slow database is an unknown state, not an offered model. */
export function withModelStateTimeout<T>(p: Promise<T>, ms = MODEL_STATE_READ_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`model state read timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}
