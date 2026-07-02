import { createSupabaseAuthServer } from "@/lib/supabase-auth-server";
import { supabaseServer } from "@/lib/supabase-server";

/**
 * Krakatoa product identity. Linked 1:1 to Supabase auth.users via user_id.
 * All product resources are owned by profile_id — never by the raw auth UUID
 * or email directly.
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
    "Database table profiles is missing. Run: npm run db:setup — or apply supabase/migrations/003_platform_foundation_nextauth_single_user.sql in the Supabase SQL Editor.",
  );
}

/** Resolve the authenticated Supabase user (id + email), or null. */
async function getSessionUser(): Promise<{ id: string; email: string } | null> {
  const supabase = createSupabaseAuthServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) return null;
  return { id: user.id, email: user.email };
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
 * Resolve the caller's existing profile, applying the one-time NextAuth →
 * Supabase Auth "lazy patch" when needed. Returns null when the user has no
 * profile yet — it never CREATES one.
 *
 * Lookup order:
 *   a. By auth.users.id (user_id) — normal path for already-migrated users.
 *   b. Lazy patch: match by email → UPDATE the profile's user_id to the new
 *      auth.users.id (and platform_tokens.user_id so the YouTube cron keeps
 *      working). Repoints an existing user's profile on their first Supabase
 *      Auth login, so read-only surfaces (dashboard, admin gating) resolve
 *      correctly without needing a write route to run first.
 */
async function findAndPatchProfile(sessionUser: {
  id: string;
  email: string;
}): Promise<Profile | null> {
  // a. Fast path — user already migrated or freshly created.
  const existing = await fetchProfileByUserId(sessionUser.id);
  if (existing) return existing;

  // b. Lazy patch — existing user's first login via Supabase Auth. Their
  //    profile was created with the old NextAuth users.id; match by email.
  const { data: emailMatch } = await supabaseServer
    .from(PROFILES_TABLE)
    .select("*")
    .eq("email", sessionUser.email)
    .maybeSingle();

  if (!emailMatch) return null;

  const match = emailMatch as Profile;
  if (match.user_id === sessionUser.id) return match;

  const { data: patched, error: patchErr } = await supabaseServer
    .from(PROFILES_TABLE)
    .update({ user_id: sessionUser.id })
    .eq("id", match.id)
    .select("*")
    .single();

  if (!patchErr && patched) {
    // Also update platform_tokens so the YouTube cron job can still find the
    // token after the user_id changes.
    await supabaseServer
      .from("platform_tokens")
      .update({ user_id: sessionUser.id })
      .eq("user_id", match.user_id);

    return patched as Profile;
  }

  // Race: another concurrent request already patched → fetch by new id.
  return fetchProfileByUserId(sessionUser.id);
}

/**
 * Get or create the current user's Krakatoa profile.
 *
 * Reuses findAndPatchProfile() for the resolve + lazy-patch steps, then creates
 * a fresh profile for a brand-new user. Throws if unauthenticated. Callers that
 * need a nullable result should use getCurrentProfile().
 */
async function getOrCreateProfileFromSupabaseAuth(): Promise<Profile> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) {
    throw new Error("Not authenticated.");
  }

  const found = await findAndPatchProfile(sessionUser);
  if (found) return found;

  // Brand-new user — create their profile.
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
 * Return the current user's profile, or null when unauthenticated / no profile
 * exists yet. Applies the one-time email → auth.users.id lazy patch (see
 * findAndPatchProfile) so read-only surfaces resolve a migrated profile, but
 * never CREATES a profile.
 */
export async function getCurrentProfile(): Promise<Profile | null> {
  const sessionUser = await getSessionUser();
  if (!sessionUser) return null;
  return findAndPatchProfile(sessionUser);
}

/**
 * Require an authenticated Krakatoa profile (creating it on first use).
 * Mutation/query routes should call this and scope every query by the
 * returned profile.id. Throws "Not authenticated." when there is no session.
 */
export async function requireCurrentProfile(): Promise<Profile> {
  return getOrCreateProfileFromSupabaseAuth();
}
