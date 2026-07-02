import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

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
  const next = searchParams.get("next") ?? "/dashboard";

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

  // Code missing or exchange failed — go to login with an error hint.
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
