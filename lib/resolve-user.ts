import { createSupabaseAuthServer } from "@/lib/supabase-auth-server";

/**
 * Returns the signed-in Supabase auth.users.id, or null if unauthenticated.
 *
 * After the NextAuth → Supabase Auth migration, auth.users.id IS the stable
 * user identifier — no separate `users` table lookup needed.
 *
 * Used by legacy-named API routes that still reference user_id directly
 * (product-photo/history, storyboards, creations/*). Production completed
 * the one-time ID cutover, so those rows now use auth.users.id too.
 */
export async function getSessionUserId(): Promise<string | null> {
  const supabase = createSupabaseAuthServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}
