import { createClient, SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser-side Supabase client (anon key) used ONLY for signed-URL uploads
 * (`uploadToSignedUrl`). The actual write is authorized by a one-time token the
 * server mints with the service role, so the anon key never grants write access
 * on its own and no Storage policy changes are required.
 *
 * The service role key is server-only and must never reach the browser — that is
 * why this is a separate client from `lib/supabase.ts` / `lib/supabase-server.ts`.
 */
let browserClient: SupabaseClient | null = null;

export function getSupabaseBrowser(): SupabaseClient {
  if (browserClient) return browserClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  if (!url || !anonKey) {
    throw new Error(
      "Supabase browser client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }

  browserClient = createClient(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return browserClient;
}
