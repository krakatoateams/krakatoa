import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/profiles-db";
import { listNotificationViews } from "@/lib/notifications-db";
import { errorLogSafe } from "@/lib/error-log-safe";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications
 *
 * The caller's newest Notifications, already rendered (title/body/links).
 * Fetched only when the bell panel opens; the badge polls unread-count.
 */
export async function GET() {
  try {
    // Read-only lookup: polling must never create a profile.
    const profile = await getCurrentProfile();
    if (!profile) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    const items = await listNotificationViews(profile);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: unknown) {
    if (error instanceof Error && /not authenticated/i.test(error.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    console.error("[api/notifications] list failed:", errorLogSafe(error));
    return NextResponse.json({ error: "Failed to load notifications." }, { status: 500 });
  }
}
