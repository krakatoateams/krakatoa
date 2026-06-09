import { getCurrentProfile, type Profile } from "@/lib/profiles-db";
import {
  getActiveAdminByEmail,
  linkAdminProfile,
  type AdminUser,
} from "@/lib/admin-users-db";

/**
 * Server-side admin authorization.
 *
 * THE security boundary for the admin panel. Every admin page and every admin
 * API route MUST gate on these helpers. Client-side hiding (e.g. the sidebar
 * Admin link) is cosmetic only and must never be relied on.
 *
 * Resolution chain (reuses the existing profile resolver):
 *   NextAuth session -> users (by email) -> profiles -> admin_users (active)
 *
 * admin_users is the source of truth. The seed emails in the migration are only
 * the initial bootstrap, not a long-term hardcoded allowlist.
 */

export class NotAuthenticatedError extends Error {
  readonly code = "NOT_AUTHENTICATED";
  constructor(message = "Not authenticated.") {
    super(message);
    this.name = "NotAuthenticatedError";
  }
}

export class NotAdminError extends Error {
  readonly code = "NOT_ADMIN";
  constructor(message = "Forbidden.") {
    super(message);
    this.name = "NotAdminError";
  }
}

export type CurrentAdmin = {
  admin: AdminUser;
  profile: Profile;
};

/**
 * Resolve the current admin, or null if the caller is unauthenticated OR is
 * authenticated but not an active admin. Does not throw for the common cases —
 * use this in pages/UI gating. Infra failures still throw.
 */
export async function getCurrentAdmin(): Promise<CurrentAdmin | null> {
  const profile = await getCurrentProfile();
  if (!profile || !profile.email) return null;

  const admin = await getActiveAdminByEmail(profile.email);
  if (!admin) return null;

  // Opportunistically backfill the profile link for audit/joins. Non-fatal.
  if (!admin.profile_id) {
    await linkAdminProfile(profile.email, profile.id);
  }

  return { admin, profile };
}

/**
 * Require an active admin. Throws NotAuthenticatedError (-> 401) when there is
 * no session, or NotAdminError (-> 403) when the session is not an active admin.
 * Use this at the top of every admin API route. Map the errors with
 * `adminErrorResponse` (or replicate the mapping) so infra failures stay 500.
 */
export async function requireAdmin(): Promise<CurrentAdmin> {
  const profile = await getCurrentProfile();
  if (!profile || !profile.email) {
    throw new NotAuthenticatedError();
  }

  const admin = await getActiveAdminByEmail(profile.email);
  if (!admin) {
    throw new NotAdminError();
  }

  if (!admin.profile_id) {
    await linkAdminProfile(profile.email, profile.id);
  }

  return { admin, profile };
}

/** True when the given email is an active admin. Convenience for tooling/tests. */
export async function assertAdminEmail(email: string): Promise<boolean> {
  const admin = await getActiveAdminByEmail(email);
  return Boolean(admin);
}
