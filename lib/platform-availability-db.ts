import { supabaseServer } from "@/lib/supabase-server";
import type { Platform } from "@/lib/platform-availability-pure";

/**
 * Platform availability data access (service-role). See
 * lib/platform-availability-pure.ts and supabase/migrations/101_platform_availability.sql
 * for the concept and schema.
 */

const PLATFORM_AVAILABILITY_TABLE = "platform_availability";

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (
    error.message.includes("platform_availability") &&
    (error.message.includes("schema cache") || error.message.includes("does not exist"))
  ) {
    throw new Error(
      "Database table platform_availability is missing. Run: npm run db:setup — or apply supabase/migrations/101_platform_availability.sql.",
    );
  }
  throw new Error(error.message || fallback);
}

/**
 * All three platforms' enabled state. Fail-open (defaults every platform to
 * enabled) on a missing table/row rather than locking everyone out of
 * TikTok/Instagram/YouTube because one unrelated migration hasn't run yet —
 * matches this app's existing tool-availability fail-open convention.
 */
export async function getPlatformAvailability(): Promise<Record<Platform, boolean>> {
  const defaults: Record<Platform, boolean> = { tiktok: true, instagram: true, youtube: true };
  const { data, error } = await supabaseServer.from(PLATFORM_AVAILABILITY_TABLE).select("platform, enabled");

  if (error) {
    console.warn("[platform-availability] query failed, defaulting every platform to enabled:", error.message);
    return defaults;
  }

  const rows = (data ?? []) as { platform: Platform; enabled: boolean }[];
  for (const row of rows) {
    defaults[row.platform] = row.enabled;
  }
  return defaults;
}

export async function setPlatformEnabled(platform: Platform, enabled: boolean): Promise<void> {
  const { error } = await supabaseServer
    .from(PLATFORM_AVAILABILITY_TABLE)
    .upsert({ platform, enabled, updated_at: new Date().toISOString() }, { onConflict: "platform" });

  handleError(error, "Failed to update platform availability.");
}
