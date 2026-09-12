import { NextResponse } from "next/server";
import { requireAdmin, type CurrentAdmin } from "@/lib/admin-auth";
import { classifyAdminError } from "@/lib/admin-auth-pure";

export { classifyAdminError } from "@/lib/admin-auth-pure";

/**
 * Shared HTTP helpers for admin API routes.
 *
 * Contract (mirrors the generation routes):
 *   401 — no session (NotAuthenticatedError)
 *   403 — authenticated but not an active admin (NotAdminError)
 *   404 — admin row does not exist (AdminNotFoundError)
 *   409 — would remove the last active admin (LastAdminError)
 *   500 — anything else (infra failure)
 */

/** Map a thrown error to the correct admin HTTP response. */
export function adminErrorResponse(e: unknown): NextResponse {
  const mapped = classifyAdminError(e);
  if (mapped.status === 500) {
    console.error("[admin-api] unexpected error:", e);
  }
  return NextResponse.json({ error: mapped.error }, { status: mapped.status });
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
