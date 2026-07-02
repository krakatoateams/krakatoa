import { createSupabaseAuthServer } from "@/lib/supabase-auth-server";

/**
 * Returns the signed-in Supabase auth.users.id, or null if unauthenticated.
 *
 * After the NextAuth → Supabase Auth migration, auth.users.id IS the stable
 * user identifier — no separate `users` table lookup needed.
 *
 * Used by legacy API routes that reference user_id directly
 * (product-photo/history, storyboards, creations/*). After the deferred
 * cleanup SQL runs and all FKs point to auth.users, the returned id will
 * match correctly for existing rows.
 */
export async function getSessionUserId(): Promise<string | null> {
  const supabase = createSupabaseAuthServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
