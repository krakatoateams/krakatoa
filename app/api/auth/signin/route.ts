import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAuthServer } from "@/lib/supabase-auth-server";
import { checkLoginLock, recordFailedLoginAttempt, clearLoginAttempts } from "@/lib/login-attempts-db";
import { checkRateLimit } from "@/lib/rate-limit";

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
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
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
      return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
    }
    email = body.email.trim();
    password = body.password;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const lockState = await checkLoginLock(email);
  if (lockState.locked) {
    return NextResponse.json(
      { error: "Too many failed attempts.", code: "too_many_attempts", retryAfterSec: lockState.retryAfterSec },
      { status: 429 },
    );
  }

  const supabase = createSupabaseAuthServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    const afterFail = await recordFailedLoginAttempt(email);
    if (afterFail.locked) {
      return NextResponse.json(
        { error: "Too many failed attempts.", code: "too_many_attempts", retryAfterSec: afterFail.retryAfterSec },
        { status: 429 },
      );
    }
    return NextResponse.json(
      {
        error: error.message,
        code: (error as { code?: string }).code ?? null,
        attemptsRemaining: afterFail.attemptsRemaining,
      },
      { status: 401 },
    );
  }

  await clearLoginAttempts(email);
  return NextResponse.json({ success: true });
}
