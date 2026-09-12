/**
 * Pure admin authorization outcomes. No Supabase, no Next.js — runnable as
 * `npx tsx lib/admin-auth-self-check.ts`.
 *
 * HTTP contract:
 *   401 — no session
 *   403 — authenticated but not an active admin
 *   404 — admin row does not exist
 *   409 — would remove the last active admin
 *   500 — infra failure
 */

export class NotAuthenticatedError extends Error {
  readonly code = "NOT_AUTHENTICATED";
  constructor(message = "Not authenticated.") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

export class NotAdminError extends Error {
  readonly code = "NOT_ADMIN";
  constructor(message = "Forbidden.") {
    super(message);
    this.name = "NotAdminError";
  }
}

export class LastAdminError extends Error {
  readonly code = "LAST_ADMIN";
  constructor(message = "Cannot remove the last active admin.") {
    super(message);
    this.name = "LastAdminError";
  }
}

export class AdminNotFoundError extends Error {
  readonly code = "ADMIN_NOT_FOUND";
  constructor(message = "Admin not found.") {
    super(message);
    this.name = "AdminNotFoundError";
  }
}

export type AdminErrorClassification = {
  status: number;
  error: string;
};

/** Map a thrown admin-boundary error to status + public body. */
export function classifyAdminError(e: unknown): AdminErrorClassification {
  if (e instanceof NotAuthenticatedError) {
    return { status: 401, error: "Not authenticated." };
  }
  if (e instanceof NotAdminError) {
    return { status: 403, error: "Forbidden." };
  }
  if (e instanceof LastAdminError) {
    return { status: 409, error: e.message };
  }
  if (e instanceof AdminNotFoundError) {
    return { status: 404, error: e.message };
  }
  if (e instanceof Error && /not authenticated/i.test(e.message)) {
    return { status: 401, error: "Not authenticated." };
  }
  return { status: 500, error: "Internal server error." };
}

export type RevokeAdminResult =
  | { action: "not_found" }
  | { action: "last_admin" }
  | { action: "revoked"; admin: { id: string } };

/** Translate the atomic revoke RPC result into the JS error contract. */
export function interpretRevokeAdminResult<T extends { id: string }>(
  result: { action: string; admin?: T },
): T {
  if (result.action === "not_found") {
    throw new AdminNotFoundError();
  }
  if (result.action === "last_admin") {
    throw new LastAdminError();
  }
  if (result.action === "revoked" && result.admin) {
    return result.admin;
  }
  throw new Error("Failed to revoke admin.");
}
