import { NextResponse } from "next/server";
import { getCurrentProfile } from "@/lib/profiles-db";
import { getEffectivePricing } from "@/lib/pricing-resolver";

// Read-only effective pricing for client cost labels. Authenticated (any signed-in
// user), NOT admin-only. Values are already fallback-applied by the resolver so the
// client always receives usable numbers that match backend billing within the
// resolver's cache window. No balance, transaction, payment, or secret data.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const pricing = await getEffectivePricing();
    return NextResponse.json({ pricing });
  } catch (e) {
    console.error("[credits/pricing] failed:", e);
    return NextResponse.json({ error: "Failed to load pricing." }, { status: 500 });
  }
}
