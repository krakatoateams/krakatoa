import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * Krakatoa product identity. Linked 1:1 to the NextAuth `users` table via
 * `user_id`. All product resources are owned by `profile_id` — never by the
 * raw NextAuth user id or email.
 */
export type Profile = {
  id: string;
  user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  onboarding_completed: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const PROFILES_TABLE = "profiles";

function tableMissingMessage(msg: string): boolean {
  return msg.includes("profiles") && msg.includes("schema cache");
}

function missingTableError(): Error {
  return new Error(
    "Database table profiles is missing. Run: npm run db:setup — or apply supabase/migrations/003_platform_foundation_nextauth_single_user.sql in the Supabase SQL Editor."
  );
}

/** Resolve the auth-level NextAuth users.id for the current session, or null. */
async function getSessionUser(): Promise<{ id: string; email: string } | null> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email) return null;

  const { data, error } = await supabaseServer
    .from("users")
    .select("id, email")
    .eq("email", email)
    .single();

  if (error || !data?.id) return null;
  return { id: data.id as string, email: (data.email as string) ?? email };
}

async function fetchProfileByUserId(userId: string): Promise<Profile | null> {
  const { data, error } = await supabaseServer
    .from(PROFILES_TABLE)
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    if (tableMissingMessage(error.message)) throw missingTableError();
    throw new Error(error.message);
  }
  return (data as Profile | null) ?? null;
}

/**
 * Get the current user's Krakatoa profile, creating it on first use.
 *
 * Flow: NextAuth session -> users row (by email) -> profiles row (create if
 * missing). The session email is copied into `profiles.email` for
 * display/search convenience only; ownership relies on `user_id -> users.id`.
 *
 * Throws if there is no authenticated session / matching users row — callers
 * that need a nullable result should use `getCurrentProfile()`.
 */
export async function getOrCreateProfileFromNextAuth(): Promise<Profile> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    throw new Error("Not authenticated.");
  }

  const existing = await fetchProfileByUserId(sessionUser.id);
  if (existing) return existing;

  const { data, error } = await supabaseServer
    .from(PROFILES_TABLE)
    .insert({ user_id: sessionUser.id, email: sessionUser.email })
    .select("*")
    .single();

  if (error || !data) {
    // Handle the race where a concurrent request created the row first.
    if (error && /duplicate key|unique/i.test(error.message)) {
      const raced = await fetchProfileByUserId(sessionUser.id);
      if (raced) return raced;
    }
    const msg = error?.message || "Failed to create profile.";
    if (tableMissingMessage(msg)) throw missingTableError();
    throw new Error(msg);
  }

  return data as Profile;
}

/**
 * Return the current user's profile, or null when unauthenticated / no
 * matching users row. Does NOT create a profile.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;
  return fetchProfileByUserId(sessionUser.id);
}

/**
 * Require an authenticated Krakatoa profile (creating it on first use).
 * Mutation/query routes should call this and scope every query by the
 * returned `profile.id`. Throws "Not authenticated." when there is no session.
 */
export async function requireCurrentProfile(): Promise<Profile> {
  return getOrCreateProfileFromNextAuth();
}
