import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getAdminWallets } from "@/lib/admin-metrics-db";
import { addBonusCredits } from "@/lib/credits-db";
import {
  type CreditExpirySource,
  expiresAtFor,
  getExpirySettings,
} from "@/lib/expiry-settings-db";

// Grant additive BONUS credits to an ADMIN wallet. Unlike /set (which writes an
// adjustment to reach an exact target), this adds a new bonus lot tagged with a
// bonus source so it inherits that source's configured expiry.
//
// Scope mirrors /set: only ACTIVE admin profiles are grantable here (dummy-phase
// tool, not a general grant-to-any-user endpoint).
export const dynamic = "force-dynamic";

const MAX_GRANT = 1_000_000;
const BONUS_SOURCES: CreditExpirySource[] = ["new_user_bonus", "purchase_bonus"];

export async function POST(req: Request) {
  return withAdmin(async (ctx) => {
    let body: { profileId?: unknown; amount?: unknown; source?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const profileId = typeof body.profileId === "string" ? body.profileId.trim() : "";
    if (!profileId) {
      return NextResponse.json({ error: "profileId is required." }, { status: 400 });
    }

    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_GRANT) {
      return NextResponse.json(
        { error: `amount must be an integer between 1 and ${MAX_GRANT}.` },
        { status: 400 }
      );
    }

    const source = (
      typeof body.source === "string" ? body.source : "new_user_bonus"
    ) as CreditExpirySource;
    if (!BONUS_SOURCES.includes(source)) {
      return NextResponse.json(
        { error: `source must be one of: ${BONUS_SOURCES.join(", ")}.` },
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

    // Compute the expiry for display (addBonusCredits stamps the same value).
    const expiresAt = expiresAtFor(source, await getExpirySettings());

    const result = await addBonusCredits({
      profileId,
      amount,
      source,
      idempotencyKey: `admin_bonus:${profileId}:${randomUUID()}`,
      description: `Admin bonus grant (${source})`,
      metadata: {
        granted_by_email: ctx.profile.email,
        granted_by_profile_id: ctx.profile.id,
        target_email: target.email,
        source,
      },
    });

    return NextResponse.json({
      profileId,
      email: target.email,
      granted: amount,
      source,
      balance: result.wallet.balance,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    });
  });
}
