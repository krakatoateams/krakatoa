import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import {
  authCallbackFailureUrl,
  passwordResetRetryUrl,
  sanitizeNextPath,
} from "@/lib/safe-redirect";
import {
  PASSWORD_RECOVERY_PROOF_COOKIE,
  PASSWORD_RECOVERY_PROOF_MAX_AGE_SEC,
  passwordRecoveryDestinationFromLanding,
  passwordRecoveryProofValue,
} from "@/lib/password-recovery";
import { SUPABASE_AUTH_CACHE_HEADERS } from "@/lib/supabase-auth-response";

function authRedirect(url: string): NextResponse {
  return NextResponse.redirect(url, {
    headers: SUPABASE_AUTH_CACHE_HEADERS,
  });
}

/**
 * Handles Supabase Auth's PKCE OAuth callback.
 *
 * Flow:
 *   1. User clicks "Continue with Google" on /login
 *   2. Supabase redirects to Google for consent
 *   3. Google redirects back here with ?code=<pkce_code>
 *   4. We exchange the code for a session (sets auth cookies)
 *   5. Redirect to the `next` param (or /dashboard)
 *
 * The `next` param is threaded through via the `redirectTo` option in
 * signInWithOAuth: `.../auth/callback?next=/tools/scheduler`
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const flow = searchParams.get("flow");
  // This route is a public, directly-reachable URL — reachable in practice
  // today only requires the calling browser to hold a matching PKCE
  // code_verifier, which it only would if it initiated the flow through our
  // own (sanitized) login/forgot-password UI. That's not something to lean
  // on as the only guard, though: validate independently here too, same as
  // app/login/page.tsx — see lib/safe-redirect.ts for why prepending our
  // own origin string alone (the old reasoning here) is NOT sufficient on
  // its own (the userinfo "@" trick defeats plain concatenation).
  const next = sanitizeNextPath(searchParams.get("next"));

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet, headersToSet) {
            void headersToSet;
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
            // authRedirect applies the equivalent private/no-store headers.
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = authRedirect(`${origin}${next}`);
      const recoveryDestination =
        flow === "recovery"
          ? passwordRecoveryDestinationFromLanding(next)
          : null;
      if (recoveryDestination) {
        response.cookies.set(
          PASSWORD_RECOVERY_PROOF_COOKIE,
          passwordRecoveryProofValue(recoveryDestination),
          {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production",
            path: "/",
            maxAge: PASSWORD_RECOVERY_PROOF_MAX_AGE_SEC,
          },
        );
      } else {
        response.cookies.set(PASSWORD_RECOVERY_PROOF_COOKIE, "", {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 0,
        });
      }
      return response;
    }
  }

  // Code missing or exchange failed. A password-recovery link that's
  // expired/already-used sends the user back to /forgot-password with a
  // specific message instead of the generic login failure below.
  // `next` is /reset-password for older emails sent before the reset flow
  // moved into a modal (app/reset-password/page.tsx stays as a fallback for
  // those), or /dashboard?resetPassword=1 for anything sent after.
  if (next.startsWith("/reset-password") || next.includes("resetPassword=")) {
    return authRedirect(passwordResetRetryUrl(origin, next));
  }

  // Everything else (OAuth, signup confirmation) — go to login with an
  // error hint (surfaced by app/login/page.tsx's `callbackError`).
  return authRedirect(authCallbackFailureUrl(origin, next));
}
