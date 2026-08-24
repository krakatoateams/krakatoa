import { supabaseServer } from "@/lib/supabase-server";

/**
 * Per-email login lockout data access (service-role) — see
 * supabase/migrations/064_login_attempts.sql and app/api/auth/signin/route.ts.
 * Keyed by lowercased, trimmed email so casing differences at signup/login
 * never split one account across two tracked rows.
 */

const TABLE = "login_attempts";
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 5 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type LoginLockState = {
  locked: true;
  retryAfterSec: number;
} | {
  locked: false;
  attemptsRemaining: number;
};

/** Read-only check — does NOT record an attempt, just reports current lock state. */
export async function checkLoginLock(email: string): Promise<LoginLockState> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("failed_count, locked_until")
    .eq("email", normalizeEmail(email))
    .maybeSingle();

  if (error) {
    // Fail open — a lockout-tracking outage should never itself block sign-in.
    console.warn("[login-attempts] checkLoginLock read failed, failing open:", error);
    return { locked: false, attemptsRemaining: MAX_ATTEMPTS };
  }

  if (data?.locked_until && new Date(data.locked_until).getTime() > Date.now()) {
    const retryAfterSec = Math.ceil((new Date(data.locked_until).getTime() - Date.now()) / 1000);
    return { locked: true, retryAfterSec };
  }

  const failedCount = data?.failed_count ?? 0;
  return { locked: false, attemptsRemaining: Math.max(0, MAX_ATTEMPTS - failedCount) };
}

/**
 * Record a failed password attempt. Locks the email for LOCK_DURATION_MS once
 * failed_count reaches MAX_ATTEMPTS. A lock that has already expired resets
 * the counter first (a stale lock shouldn't count toward a fresh streak).
 */
export async function recordFailedLoginAttempt(email: string): Promise<LoginLockState> {
  const key = normalizeEmail(email);
  const now = new Date();

  const { data: existing, error: readError } = await supabaseServer
    .from(TABLE)
    .select("failed_count, locked_until")
    .eq("email", key)
    .maybeSingle();

  if (readError) {
    console.warn("[login-attempts] recordFailedLoginAttempt read failed, failing open:", readError);
    return { locked: false, attemptsRemaining: MAX_ATTEMPTS - 1 };
  }

  const lockExpired = existing?.locked_until && new Date(existing.locked_until).getTime() <= now.getTime();
  const priorCount = !existing || lockExpired ? 0 : existing.failed_count;
  const nextCount = priorCount + 1;
  const nowIso = now.toISOString();

  if (nextCount >= MAX_ATTEMPTS) {
    const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS).toISOString();
    const { error } = await supabaseServer
      .from(TABLE)
      .upsert(
        { email: key, failed_count: nextCount, locked_until: lockedUntil, last_attempt_at: nowIso },
        { onConflict: "email" },
      );
    if (error) console.warn("[login-attempts] failed to persist lock:", error);
    return { locked: true, retryAfterSec: Math.ceil(LOCK_DURATION_MS / 1000) };
  }

  const { error } = await supabaseServer
    .from(TABLE)
    .upsert(
      { email: key, failed_count: nextCount, locked_until: null, last_attempt_at: nowIso },
      { onConflict: "email" },
    );
  if (error) console.warn("[login-attempts] failed to persist attempt count:", error);
  return { locked: false, attemptsRemaining: MAX_ATTEMPTS - nextCount };
}

/** Called on a successful sign-in — a clean login means the streak is over. */
export async function clearLoginAttempts(email: string): Promise<void> {
  const { error } = await supabaseServer.from(TABLE).delete().eq("email", normalizeEmail(email));
  if (error) console.warn("[login-attempts] failed to clear attempts:", error);
}
