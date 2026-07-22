import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { sanitizeNextPath } from "@/lib/safe-redirect";

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
    const cookieStore = cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          },
        },
      },
    );

    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Code missing or exchange failed. A password-recovery link that's
  // expired/already-used sends the user back to /forgot-password with a
  // specific message instead of the generic login failure below.
  if (next.startsWith("/reset-password")) {
    return NextResponse.redirect(`${origin}/forgot-password?error=expired`);
  }

  // Everything else (OAuth, signup confirmation) — go to login with an
  // error hint (surfaced by app/login/page.tsx's `callbackError`).
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
