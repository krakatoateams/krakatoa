import { NextRequest, NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { listCreditTransactions } from "@/lib/credits-db";

// Read-only ledger feed for the signed-in profile, used by the Profile Settings
// Credits tab. Never mutates balance. Mirrors the auth/error handling of
// app/api/credits/balance/route.ts.
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  try {
    const profile = await requireCurrentProfile();

    const requested = parseInt(
      new URL(req.url).searchParams.get("limit") || "",
      10
    );
    const limit = Number.isFinite(requested)
      ? Math.min(MAX_LIMIT, Math.max(1, requested))
      : DEFAULT_LIMIT;

    const items = await listCreditTransactions(profile.id, { limit });
    return NextResponse.json({ items });
  } catch (e) {
    if (e instanceof Error && /not authenticated/i.test(e.message)) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    console.error("[credits/transactions] failed to list transactions:", e);
    return NextResponse.json(
      { error: "Failed to list transactions." },
      { status: 500 }
    );
  }
}
