import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server-side Supabase client for reading the authenticated user's session.
 * Uses the anon key + cookie adapter so it can validate the JWT that the
 * Supabase Auth client writes into cookies.
 *
 * Call inside Server Components, Route Handlers, and Server Actions.
 * The try/catch in setAll is required: Server Components can't set cookies,
 * only Route Handlers and Server Actions can — the middleware handles token
 * refresh for Server Component requests.
 */
export function createSupabaseAuthServer() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Component context — cookie writes are a no-op here.
            // Middleware handles session refresh for these requests.
          }
        },
      },
    },
  );
}
