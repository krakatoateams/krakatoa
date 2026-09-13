import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { forwardSupabaseAuthUpdates } from "@/lib/supabase-auth-response";
import {
  isLoggedOutPublicAppRoute,
  loggedOutAuthRedirectUrl,
} from "@/lib/public-route-policy";
import {
  PASSWORD_RECOVERY_PROOF_COOKIE,
  passwordRecoveryDestinationFromProof,
  passwordRecoveryGateDecision,
} from "@/lib/password-recovery";
import { passwordResetLandingPath } from "@/lib/safe-redirect";

// Routes browsable without a session — the page itself gates individual
// actions (generate, schedule, save, ...) client-side via useAuthModal()
// instead of a hard server redirect. See kelolako-dashboard-nonlogin-plan.
// Grows one page at a time as each gets its own action-level gating.
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api/");
  const recoveryDestination = passwordRecoveryDestinationFromProof(
    request.cookies.get(PASSWORD_RECOVERY_PROOF_COOKIE)?.value,
  );

  // API routes were not part of the middleware before the recovery gate.
  // Keep their normal path zero-cost unless this browser holds a pending
  // recovery proof; the state endpoint itself must remain reachable so the
  // reset modal can inspect and clear that proof.
  if (
    isApi &&
    (pathname === "/api/auth/recovery-state" || !recoveryDestination)
  ) {
    return NextResponse.next();
  }

  // Start with a passthrough response. setAll may replace this variable so
  // refreshed session cookies are forwarded to both the browser and the
  // downstream Server Component render — critical for session continuity.
  let supabaseResponse = NextResponse.next({ request });
  let applyLatestAuthUpdates = (response: NextResponse) => response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headersToSet) {
          // Step 1: reflect cookies onto the mutated request (for Server Components).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          applyLatestAuthUpdates = (response) => {
            forwardSupabaseAuthUpdates(
              cookiesToSet,
              headersToSet,
              ({ name, value, options }) =>
                response.cookies.set(name, value, options),
              (name, value) => response.headers.set(name, value),
            );
            return response;
          };
          // Step 2: create a response carrying the updated request headers.
          // Step 3: forward cookies and anti-cache headers to the browser.
          supabaseResponse = applyLatestAuthUpdates(
            NextResponse.next({ request }),
          );
        },
      },
    },
  );

  // getUser() validates the JWT with Supabase's server (not just the local
  // cookie) — required for security on protected routes.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const recoveryGate = passwordRecoveryGateDecision({
    authenticated: Boolean(user),
    recoveryDestination,
    requestPathWithSearch: request.nextUrl.pathname + request.nextUrl.search,
    isApi,
    isRecoveryStateApi: pathname === "/api/auth/recovery-state",
  });

  if (recoveryGate === "reject-api") {
    return applyLatestAuthUpdates(
      NextResponse.json(
        {
          error: "Password reset must be completed first.",
          code: "PASSWORD_RECOVERY_REQUIRED",
        },
        {
          status: 403,
          headers: { "Cache-Control": "private, no-store" },
        },
      ),
    );
  }

  if (recoveryGate === "require-reset-page" && recoveryDestination) {
    return applyLatestAuthUpdates(
      NextResponse.redirect(
        new URL(passwordResetLandingPath(recoveryDestination), request.url),
      ),
    );
  }

  if (!user) {
    if (isApi) return supabaseResponse;
    // Public routes render logged-out; everything else the matcher below
    // catches (dashboard subroutes, other /tools/*, /admin/*) still
    // redirects, but now to /dashboard (which opens the sign-in modal
    // itself) instead of the old standalone /login page.
    if (isLoggedOutPublicAppRoute(pathname)) {
      return supabaseResponse;
    }
    return applyLatestAuthUpdates(
      NextResponse.redirect(loggedOutAuthRedirectUrl(request.nextUrl)),
    );
  }

  // Return supabaseResponse (not a fresh NextResponse.next()) so the
  // potentially-refreshed session cookies propagate correctly.
  return supabaseResponse;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/tools/:path*",
    "/admin/:path*",
    "/api/:path*",
  ],
};
