import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/profiles-db";
import { getPricingPayload } from "@/lib/pricing-resolver";

// Read-only pricing for client cost labels (Pricing Config v2.2). Authenticated
// (any signed-in user), NOT admin-only. Returns the billing settings + the
// PRIMARY v2 provider-cost config rows only (no legacy/deprecated rows, no legacy
// snapshot), so the client computes labels with the SAME pricing math the server
// bills with (within the ~60s resolver cache window). For any key not present the
// client falls back to the built-in v2 defaults (lib/pricing-defaults.ts). No
// balance, transaction, payment, or secret data.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { billingSettings, configs } = await getPricingPayload();
    return NextResponse.json({ billingSettings, configs });
  } catch (e) {
    console.error("[credits/pricing] failed:", e);
    return NextResponse.json({ error: "Failed to load pricing." }, { status: 500 });
  }
}
