import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
    const url = request.nextUrl.clone();
    url.pathname = "/login";
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
