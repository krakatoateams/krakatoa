import { createClient } from "@supabase/supabase-js";

/**
 * The Next.js App Router patches global `fetch` and caches GET responses in its
 * on-disk Data Cache by default. supabase-js issues its queries through `fetch`,
 * so without this every server read could be served from a stale (even
 * cross-restart) cached snapshot — e.g. pricing tiers not updating after an
 * admin save. Force `no-store` on the client's fetch so DB reads are always live.
 */
const noStoreFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, cache: "no-store" });

export const supabaseServer = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: noStoreFetch },
  },
);
