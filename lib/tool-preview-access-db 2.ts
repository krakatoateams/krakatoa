import { supabaseServer } from "@/lib/supabase-server";

/**
 * Narrow allowlist for previewing a coming_soon-gated tool page without
 * granting full admin panel access — see admin_users / lib/admin-auth.ts for
 * that much bigger grant, and supabase/migrations/076_tool_preview_access.sql.
 */

const TABLE = "tool_preview_access";

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * True if this email may bypass a coming_soon gate. Fails CLOSED (false) on
 * any error or missing row — unlike lib/tool-access.ts's fail-open pattern,
 * this guards a deliberate block, so an outage here must never accidentally
 * expose a not-yet-ready tool to everyone.
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
