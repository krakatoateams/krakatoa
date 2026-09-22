import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getCurrentProfile } from "@/lib/profiles-db";
import { canPreviewPlatform } from "@/lib/tool-preview-access-db";
import { getPlatformAvailability, setPlatformEnabled } from "@/lib/platform-availability-db";
import type { Platform } from "@/lib/platform-availability-pure";

const PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube"];

/**
 * GET /api/platform-availability — any signed-in user (not admin-only): the
 * Scheduler compose form, Settings' Connections tab, and ConnectionStatusBadge
 * all need this to decide whether a platform renders as normal, hidden
 * ("coming soon"), or "Preview" (bypassed) — see lib/platform-availability-pure.ts.
 *
 * `canBypass` is PER-PLATFORM, not one shared flag — a real admin
 * (lib/admin-auth.ts) bypasses every platform, but the
 * tool_preview_access allowlist (lib/tool-preview-access-db.ts) can grant a
 * narrow, single-platform bypass (e.g. a Google reviewer account that needs
 * YouTube only, not Instagram too).
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const [platforms, admin, profile] = await Promise.all([
    getPlatformAvailability(),
    getCurrentAdmin(),
    getCurrentProfile(),
  ]);
  const isAdmin = !!admin;
  const canBypassEntries = await Promise.all(
    PLATFORMS.map(async (p) => [p, isAdmin || (await canPreviewPlatform(profile?.email, p))] as const),
  );
  const canBypass = Object.fromEntries(canBypassEntries) as Record<Platform, boolean>;
  return NextResponse.json({ platforms, canBypass });
}

/**
 * PATCH /api/platform-availability — admin-only toggle. Body:
 * { platform: "tiktok" | "instagram" | "youtube", enabled: boolean }
 */
export async function PATCH(request: Request) {
  const admin = await getCurrentAdmin();
  if (!admin) {
    return NextResponse.json({ error: "Admin access required." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const platform = body?.platform;
  const enabled = body?.enabled;
  if (!PLATFORMS.includes(platform) || typeof enabled !== "boolean") {
    return NextResponse.json({ error: "Invalid platform or enabled value." }, { status: 400 });
  }

  await setPlatformEnabled(platform, enabled);
  return NextResponse.json({ ok: true });
}
