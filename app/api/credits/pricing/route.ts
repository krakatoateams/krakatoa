import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/profiles-db";
import { getPricingPayload } from "@/lib/pricing-resolver";

// Read-only effective pricing for client cost labels. Authenticated (any signed-in
// user), NOT admin-only. Returns the billing settings + the public v2 pricing
// config rows + a legacy snapshot, so the client can compute labels with the SAME
// pricing math the server bills with (within the ~60s resolver cache window). No
// balance, transaction, payment, or secret data.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { billingSettings, configs, pricing } = await getPricingPayload();
    return NextResponse.json({ billingSettings, configs, pricing });
  } catch (e) {
    console.error("[credits/pricing] failed:", e);
    return NextResponse.json({ error: "Failed to load pricing." }, { status: 500 });
  }
}
