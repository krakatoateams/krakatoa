import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAuthServer } from "@/lib/supabase-auth-server";
import { checkLoginLock, recordFailedLoginAttempt, clearLoginAttempts } from "@/lib/login-attempts-db";
import { checkRateLimit } from "@/lib/rate-limit";
import { SUPABASE_AUTH_CACHE_HEADERS } from "@/lib/supabase-auth-response";

function authJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: SUPABASE_AUTH_CACHE_HEADERS,
  });
}

/**
 * POST /api/auth/signin
 * Body: { email: string, password: string }
 *
 * Server-side proxy for email/password sign-in — SignInForm no longer calls
 * supabase.auth.signInWithPassword directly, so the per-email lockout after 5
 * failed attempts (5 minutes) is actually enforceable. A client-side-only
 * attempt counter would be trivially bypassed by clearing storage or opening
 * a private window; the lock has to live on the server, tied to the email
 * being attacked. See lib/login-attempts-db.ts and
 * supabase/migrations/065_login_attempts.sql.
 *
 * createSupabaseAuthServer() uses the next/headers cookie adapter, so a
 * successful signInWithPassword here sets the same session cookies the
 * browser client would have set directly — the client just needs to know
 * the call succeeded before navigating.
 */
export async function POST(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for");
  const ip =
    (forwarded ? forwarded.split(",")[0].trim() : null) ??
    req.headers.get("x-real-ip") ??
    "unknown";

  // Cheap per-instance IP throttle as a secondary guard (same pattern as
  // /api/auth/check-provider) — the real, reliable lock below is per-email
  // and DB-backed, since this in-memory limiter doesn't survive across
  // serverless instances.
  if (!checkRateLimit(ip)) {
    return authJson({ error: "Too many requests" }, 429);
  }

  let email: string;
  let password: string;
  try {
    const body = (await req.json()) as { email?: unknown; password?: unknown };
    if (
      typeof body.email !== "string" ||
      !body.email.trim() ||
      typeof body.password !== "string" ||
      !body.password
    ) {
      return authJson({ error: "Email and password are required." }, 400);
    }
    email = body.email.trim();
    password = body.password;
  } catch {
    return authJson({ error: "Invalid request body." }, 400);
  }

  const lockState = await checkLoginLock(email);
  if (lockState.locked) {
    return authJson(
      { error: "Too many failed attempts.", code: "too_many_attempts", retryAfterSec: lockState.retryAfterSec },
      429,
    );
  }

  const supabase = createSupabaseAuthServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const afterFail = await recordFailedLoginAttempt(email);
    if (afterFail.locked) {
      return authJson(
        { error: "Too many failed attempts.", code: "too_many_attempts", retryAfterSec: afterFail.retryAfterSec },
        429,
      );
    }
    return authJson(
      {
        error: error.message,
        code: (error as { code?: string }).code ?? null,
        attemptsRemaining: afterFail.attemptsRemaining,
      },
      401,
    );
  }

  await clearLoginAttempts(email);
  return authJson({ success: true });
}
