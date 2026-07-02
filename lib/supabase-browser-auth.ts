"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Singleton browser-side Supabase client for auth operations (signIn, signOut,
 * signUp, OAuth). Uses the anon key — safe to expose in the browser.
 *
 * The same instance is shared across the app so onAuthStateChange listeners
 * and imperative auth calls always see the same session state.
 *
 * Do NOT use this for Storage signed-URL uploads — keep using
 * lib/supabase-browser.ts for that (it has persistSession: false).
 */
let client: SupabaseClient | null = null;

export function getSupabaseAuthBrowser(): SupabaseClient {
  if (client) return client;
  client = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
  return client;
}
