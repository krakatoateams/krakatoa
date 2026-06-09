import { supabaseServer } from "@/lib/supabase-server";

/**
 * Admin users data access (service-role).
 *
 * admin_users is the long-term source of truth for who may access the admin
 * panel. The seed emails in 007_admin_panel.sql are only the initial bootstrap.
 * Every read/write here uses the service role and authorization is enforced by
 * the caller (lib/admin-auth.ts) — these helpers do NOT check the caller.
 */

export type AdminRole = "owner" | "admin";
export type AdminStatus = "active" | "revoked";

export type AdminUser = {
  id: string;
  email: string;
  profile_id: string | null;
  role: AdminRole;
  status: AdminStatus;
  granted_by_profile_id: string | null;
  granted_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

const ADMIN_USERS_TABLE = "admin_users";

/** Thrown when an operation would remove the last remaining active admin. */
export class LastAdminError extends Error {
  readonly code = "LAST_ADMIN";
  constructor(message = "Cannot remove the last active admin.") {
    super(message);
    this.name = "LastAdminError";
  }
}

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (
    error.message.includes("admin_users") &&
    (error.message.includes("schema cache") ||
      error.message.includes("does not exist"))
  ) {
    throw new Error(
      "Database table admin_users is missing. Run: npm run db:setup — or apply supabase/migrations/007_admin_panel.sql."
    );
  }
  throw new Error(error.message || fallback);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** List all admin rows (active + revoked), newest grant first. */
export async function listAdmins(): Promise<AdminUser[]> {
  const { data, error } = await supabaseServer
    .from(ADMIN_USERS_TABLE)
    .select("*")
    .order("status", { ascending: true })
    .order("granted_at", { ascending: false });

  handleError(error, "Failed to list admins.");
  return (data as AdminUser[] | null) ?? [];
}

/** Fetch an admin row by email regardless of status, or null. */
export async function getAdminByEmail(email: string): Promise<AdminUser | null> {
  const { data, error } = await supabaseServer
    .from(ADMIN_USERS_TABLE)
    .select("*")
    .eq("email", normalizeEmail(email))
    .maybeSingle();

  handleError(error, "Failed to fetch admin by email.");
  return (data as AdminUser | null) ?? null;
}

/** Fetch an ACTIVE admin row by email, or null. This is the access gate. */
export async function getActiveAdminByEmail(
  email: string
): Promise<AdminUser | null> {
  const { data, error } = await supabaseServer
    .from(ADMIN_USERS_TABLE)
    .select("*")
    .eq("email", normalizeEmail(email))
    .eq("status", "active")
    .maybeSingle();

  handleError(error, "Failed to fetch active admin.");
  return (data as AdminUser | null) ?? null;
}

/** Fetch an admin row by id, or null. */
export async function getAdminById(id: string): Promise<AdminUser | null> {
  const { data, error } = await supabaseServer
    .from(ADMIN_USERS_TABLE)
    .select("*")
    .eq("id", id)
    .maybeSingle();

  handleError(error, "Failed to fetch admin.");
  return (data as AdminUser | null) ?? null;
}

/** Count active admins. Used to protect against removing the last admin. */
export async function countActiveAdmins(): Promise<number> {
  const { count, error } = await supabaseServer
    .from(ADMIN_USERS_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  handleError(error, "Failed to count active admins.");
  return count ?? 0;
}

/**
 * Add (or re-activate) an admin by email. If the email already exists it is
 * re-activated (status -> active) with the new role; otherwise a new row is
 * inserted. Idempotent and safe to call repeatedly.
 */
export async function addAdmin(params: {
  email: string;
  role?: AdminRole;
  grantedByProfileId?: string | null;
}): Promise<AdminUser> {
  const email = normalizeEmail(params.email);
  const role: AdminRole = params.role === "owner" ? "owner" : "admin";
  const existing = await getAdminByEmail(email);

  if (existing) {
    const { data, error } = await supabaseServer
      .from(ADMIN_USERS_TABLE)
      .update({
        role,
        status: "active",
        revoked_at: null,
        granted_by_profile_id: params.grantedByProfileId ?? null,
        granted_at: new Date().toISOString(),
      })
      .eq("id", existing.id)
      .select("*")
      .single();

    handleError(error, "Failed to re-activate admin.");
    return data as AdminUser;
  }

  const { data, error } = await supabaseServer
    .from(ADMIN_USERS_TABLE)
    .insert({
      email,
      role,
      status: "active",
      granted_by_profile_id: params.grantedByProfileId ?? null,
    })
    .select("*")
    .single();

  handleError(error, "Failed to add admin.");
  return data as AdminUser;
}

/**
 * Revoke an admin by id (soft remove — keeps the row for audit). Refuses to
 * revoke the last active admin (throws LastAdminError).
 */
export async function revokeAdminById(id: string): Promise<AdminUser> {
  const target = await getAdminById(id);
  if (!target) {
    throw new Error("Admin not found.");
  }

  if (target.status === "active") {
    const active = await countActiveAdmins();
    if (active <= 1) {
      throw new LastAdminError();
    }
  }

  const { data, error } = await supabaseServer
    .from(ADMIN_USERS_TABLE)
    .update({ status: "revoked", revoked_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();

  handleError(error, "Failed to revoke admin.");
  return data as AdminUser;
}

/**
 * Best-effort link of an admin row to a profile id (called opportunistically on
 * sign-in once we know the profile). Never throws on the happy-path miss.
 */
export async function linkAdminProfile(
  email: string,
  profileId: string
): Promise<void> {
  const { error } = await supabaseServer
    .from(ADMIN_USERS_TABLE)
    .update({ profile_id: profileId })
    .eq("email", normalizeEmail(email))
    .is("profile_id", null);

  // Non-fatal: linking is a convenience, not a security boundary.
  if (error) {
    console.error("[admin-users] linkAdminProfile failed:", error.message);
  }
}
