import { supabaseServer } from "@/lib/supabase-server";
import type { Platform } from "@/lib/platform-availability-pure";

/**
 * Narrow allowlist for previewing a coming_soon-gated tool page, OR one
 * specific platform's availability gate, without granting full admin panel
 * access — see admin_users / lib/admin-auth.ts for that much bigger grant,
 * supabase/migrations/076_tool_preview_access.sql, and
 * supabase/migrations/102_tool_preview_access_platform_scope.sql for the
 * optional `platform` column.
 */

const TABLE = "tool_preview_access";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * True if this email may bypass a tool's coming_soon gate. Only matches
 * GLOBAL rows (platform IS NULL) — a row scoped to one platform (see
 * canPreviewPlatform below) must never also grant this broader, unrelated
 * bypass. Fails CLOSED (false) on any error or missing row — unlike
 * lib/tool-access.ts's fail-open pattern, this guards a deliberate block, so
 * an outage here must never accidentally expose a not-yet-ready tool to
 * everyone.
 */
export async function canPreviewComingSoon(
  email: string | null | undefined
): Promise<boolean> {
  if (!email) return false;
  try {
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select("id")
      .eq("email", normalizeEmail(email))
      .is("platform", null)
      .maybeSingle();

    if (error) {
      console.warn("[tool-preview-access] check failed, failing closed:", error);
      return false;
    }
    return !!data;
  } catch (e) {
    console.warn("[tool-preview-access] check threw, failing closed:", e);
    return false;
  }
}

/**
 * True if this email may bypass ONE specific platform's availability gate
 * (see lib/platform-availability-pure.ts) — matches either a row scoped to
 * exactly this platform, or a global row (platform IS NULL, the original
 * grant). Fails CLOSED, same reasoning as canPreviewComingSoon.
 */
export async function canPreviewPlatform(
  email: string | null | undefined,
  platform: Platform,
): Promise<boolean> {
  if (!email) return false;
  try {
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select("id")
      .eq("email", normalizeEmail(email))
      .or(`platform.is.null,platform.eq.${platform}`)
      .maybeSingle();

    if (error) {
      console.warn("[tool-preview-access] platform check failed, failing closed:", error);
      return false;
    }
    return !!data;
  } catch (e) {
    console.warn("[tool-preview-access] platform check threw, failing closed:", e);
    return false;
  }
}
