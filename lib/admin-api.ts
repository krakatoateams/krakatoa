import { NextResponse } from "next/server";
import {
  NotAdminError,
  NotAuthenticatedError,
  requireAdmin,
  type CurrentAdmin,
} from "@/lib/admin-auth";
import { LastAdminError } from "@/lib/admin-users-db";

/**
 * Shared HTTP helpers for admin API routes.
 *
 * Contract (mirrors the generation routes):
 *   401 — no session (NotAuthenticatedError)
 *   403 — authenticated but not an active admin (NotAdminError)
 *   409 — would remove the last active admin (LastAdminError)
 *   500 — anything else (infra failure)
 */

/** Map a thrown error to the correct admin HTTP response. */
export function adminErrorResponse(e: unknown): NextResponse {
  if (e instanceof NotAuthenticatedError) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  if (e instanceof NotAdminError) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }
  if (e instanceof LastAdminError) {
    return NextResponse.json({ error: e.message }, { status: 409 });
  }
  // Legacy string-based auth errors from the profile resolver.
  if (e instanceof Error && /not authenticated/i.test(e.message)) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  console.error("[admin-api] unexpected error:", e);
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}

/**
 * Run an admin-gated handler. Calls requireAdmin() first, then the handler.
 * Any thrown error is mapped via adminErrorResponse so routes stay tiny.
 */
export async function withAdmin(
  handler: (ctx: CurrentAdmin) => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    const ctx = await requireAdmin();
    return await handler(ctx);
  } catch (e) {
    return adminErrorResponse(e);
  }
}
