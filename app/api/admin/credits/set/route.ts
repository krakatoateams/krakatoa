import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getAdminWallets } from "@/lib/admin-metrics-db";
import { setWalletBalance } from "@/lib/credits-db";

// Reset / top-up the dummy credit balance of an ADMIN wallet to an exact target
// (default 500 in the UI, or any non-negative amount). Admin-gated.
//
// Scope: only ACTIVE admin profiles can be set here — this is a dummy-credit
// admin tool, not a general grant-to-any-user endpoint. The target profile must
// resolve to an active admin (see getAdminWallets) or the request is rejected.
export const dynamic = "force-dynamic";

const MAX_BALANCE = 1_000_000;

export async function POST(req: Request) {
  return withAdmin(async (ctx) => {
    let body: { profileId?: unknown; targetBalance?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const profileId =
      typeof body.profileId === "string" ? body.profileId.trim() : "";
    if (!profileId) {
      return NextResponse.json(
        { error: "profileId is required." },
        { status: 400 }
      );
    }

    const targetBalance = Number(body.targetBalance);
    if (
      !Number.isInteger(targetBalance) ||
      targetBalance < 0 ||
      targetBalance > MAX_BALANCE
    ) {
      return NextResponse.json(
        {
          error: `targetBalance must be an integer between 0 and ${MAX_BALANCE}.`,
        },
        { status: 400 }
      );
    }

    // Enforce: target profile must be an active admin wallet.
    const adminWallets = await getAdminWallets();
    const target = adminWallets.find((w) => w.profile_id === profileId);
    if (!target) {
      return NextResponse.json(
        { error: "Target profile is not an active admin." },
        { status: 400 }
      );
    }

    const result = await setWalletBalance({
      profileId,
      targetBalance,
      description: `Admin set balance to ${targetBalance}`,
      metadata: {
        set_by_email: ctx.profile.email,
        set_by_profile_id: ctx.profile.id,
        target_email: target.email,
      },
    });

    return NextResponse.json({
      profileId,
      email: target.email,
      previousBalance: result.previousBalance,
      balance: result.wallet.balance,
      delta: result.delta,
      applied: result.applied,
    });
  });
}
