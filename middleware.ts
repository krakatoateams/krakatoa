import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Routes browsable without a session — the page itself gates individual
// actions (generate, schedule, save, ...) client-side via useAuthModal()
// instead of a hard server redirect. See kelolako-dashboard-nonlogin-plan.
// Grows one page at a time as each gets its own action-level gating.
const PUBLIC_APP_ROUTES = new Set([
  "/dashboard",
  "/tools/photo-v2",
  "/tools/scheduler",
  "/tools/video",
]);

export async function middleware(request: NextRequest) {
  // Start with a passthrough response. setAll may replace this variable so
  // refreshed session cookies are forwarded to both the browser and the
  // downstream Server Component render — critical for session continuity.
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          // Step 1: reflect cookies onto the mutated request (for Server Components).
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          // Step 2: create a new response carrying the updated request headers.
          supabaseResponse = NextResponse.next({ request });
          // Step 3: write cookies onto the response so the browser receives them.
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
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

  if (!user) {
    // Public routes render logged-out; everything else the matcher below
    // catches (dashboard subroutes, other /tools/*, /admin/*) still
    // redirects, but now to /dashboard (which opens the sign-in modal
    // itself) instead of the old standalone /login page.
    if (PUBLIC_APP_ROUTES.has(request.nextUrl.pathname)) {
      return supabaseResponse;
    }
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.searchParams.set("authRequired", "1");
    url.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Return supabaseResponse (not a fresh NextResponse.next()) so the
  // potentially-refreshed session cookies propagate correctly.
  return supabaseResponse;
}

export const config = {
  matcher: ["/dashboard/:path*", "/tools/:path*", "/admin/:path*"],
};
