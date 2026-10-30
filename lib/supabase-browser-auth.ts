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
 * Storage uploads do not use this client. The browser PUTs the signed URL
 * from the upload sign API and sends only the headers that response returns.
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
