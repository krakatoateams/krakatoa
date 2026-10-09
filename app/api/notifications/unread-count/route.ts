import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/profiles-db";
import { countUnreadNotifications } from "@/lib/notifications-db";
import { errorLogSafe } from "@/lib/error-log-safe";

export const dynamic = "force-dynamic";

/** GET /api/notifications/unread-count — the bell badge. Polled lightly. */
export async function GET() {
  try {
    // Read-only lookup: polling must never create a profile.
    const profile = await getCurrentProfile();
    if (!profile) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    const count = await countUnreadNotifications(profile.id);
    return NextResponse.json({ count }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error: unknown) {
    if (error instanceof Error && /not authenticated/i.test(error.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    console.error("[api/notifications/unread-count] failed:", errorLogSafe(error));
    return NextResponse.json({ error: "Failed to count notifications." }, { status: 500 });
  }
}
