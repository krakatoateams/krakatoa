import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { getCreditLotSummary } from "@/lib/credit-lots-db";

// Customer-facing credit expiry breakdown for the signed-in profile: which
// credits (by source) expire and when, plus an "expiring soon" summary.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await requireCurrentProfile();
    const summary = await getCreditLotSummary(profile.id);
    return NextResponse.json(summary);
  } catch (e) {
    if (e instanceof Error && /not authenticated/i.test(e.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    console.error("[credits/lots] failed to read lots:", e);
    return NextResponse.json({ error: "Failed to read credit breakdown." }, { status: 500 });
  }
}
