import { NextRequest, NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/profiles-db";
import { markNotificationsReadThrough } from "@/lib/notifications-db";
import { errorLogSafe } from "@/lib/error-log-safe";

export const dynamic = "force-dynamic";

/**
 * POST /api/notifications/read
 *
 * Opening the bell panel marks the caller's Notifications read, through the
 * newest one it showed. Body: { newestShownAt: ISO timestamp }.
 */
export async function POST(req: NextRequest) {
  try {
    // Read-only lookup: polling must never create a profile.
    const profile = await getCurrentProfile();
    if (!profile) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    const body = (await req.json().catch(() => null)) as { newestShownAt?: unknown } | null;
    const newestShownAt = body?.newestShownAt;
    if (typeof newestShownAt !== "string" || Number.isNaN(Date.parse(newestShownAt))) {
      return NextResponse.json({ error: "newestShownAt must be an ISO timestamp." }, { status: 400 });
    }
    // Pass the original string: Postgres keeps microseconds, and a JS
    // round-trip (toISOString) would truncate them and skip the newest row.
    await markNotificationsReadThrough(profile.id, newestShownAt);
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    if (error instanceof Error && /not authenticated/i.test(error.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    console.error("[api/notifications/read] failed:", errorLogSafe(error));
    return NextResponse.json({ error: "Failed to mark notifications read." }, { status: 500 });
  }
}
