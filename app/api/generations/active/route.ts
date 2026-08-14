import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { listActiveGenerations } from "@/lib/active-generations-db";

export const dynamic = "force-dynamic";

/**
 * GET /api/generations/active
 *
 * The caller's in-flight jobs (queued / running / recoverable) plus failures
 * from the last 15 minutes — enough for the library tiles and the layout banner
 * to survive a navigation away from the composer.
 */
export async function GET() {
  try {
    const profile = await requireCurrentProfile();
    const items = await listActiveGenerations(profile.id);
    return NextResponse.json({ items });
  } catch (error: unknown) {
    if (error instanceof Error && /not authenticated/i.test(error.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error("[generations/active] Error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
