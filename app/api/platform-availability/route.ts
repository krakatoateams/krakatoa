import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/resolve-user";
import { getCurrentAdmin } from "@/lib/admin-auth";
import { getPlatformAvailability, setPlatformEnabled } from "@/lib/platform-availability-db";
import type { Platform } from "@/lib/platform-availability-pure";

const PLATFORMS: Platform[] = ["tiktok", "instagram", "youtube"];

/**
 * GET /api/platform-availability — any signed-in user (not admin-only): the
 * Scheduler compose form and Settings' Connections tab both need this to
 * decide whether a platform renders as normal, "Soon" (locked), or
 * "Preview" (admin bypass) — see lib/platform-availability-pure.ts.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const [platforms, admin] = await Promise.all([getPlatformAvailability(), getCurrentAdmin()]);
  return NextResponse.json({ platforms, isAdmin: !!admin });
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
