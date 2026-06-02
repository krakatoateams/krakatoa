import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { getOrCreateWallet } from "@/lib/credits-db";

// Read-only wallet snapshot for the signed-in profile. Intentionally minimal:
// no transaction list, no payment data, no external calls. Used by the sidebar
// credit badge and the per-tool "refetch after success" hook.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const profile = await requireCurrentProfile();
    const wallet = await getOrCreateWallet(profile.id);
    return NextResponse.json({
      balance: wallet.balance,
      lifetimePurchased: wallet.lifetime_purchased,
      lifetimeSpent: wallet.lifetime_spent,
    });
  } catch (e) {
    if (e instanceof Error && /not authenticated/i.test(e.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    console.error("[credits/balance] failed to read wallet:", e);
    return NextResponse.json({ error: "Failed to read wallet." }, { status: 500 });
  }
}
