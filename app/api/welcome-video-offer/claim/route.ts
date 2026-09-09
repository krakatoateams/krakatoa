import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { addBonusCredits } from "@/lib/credits-db";
import {
  getWelcomeVideoOfferEligibility,
  welcomeVideoClaimIdempotencyKey,
} from "@/lib/welcome-video-offer";
import { WELCOME_VIDEO_SKILL_ID, skillHref } from "@/lib/skills";

export const dynamic = "force-dynamic";

/**
 * POST /api/welcome-video-offer/claim — grants the welcome-video credits
 * on-demand, the moment the user actually clicks Claim (not automatically at
 * signup — see migration 089). Re-validates eligibility server-side rather
 * than trusting the client, so a stale card/popup (e.g. left open in a tab
 * after the offer was disabled, or after the user already generated
 * something elsewhere) can't grant credits it shouldn't.
 *
 * The actual grant (addBonusCredits) is idempotent via
 * welcomeVideoClaimIdempotencyKey — a duplicate/racing call is a no-op, not
 * a double-grant, so this is safe to retry.
 */
export async function POST() {
  const profile = await requireCurrentProfile();

  const { eligible, creditAmount } = await getWelcomeVideoOfferEligibility(profile.id);
  if (!eligible || creditAmount <= 0) {
    return NextResponse.json(
      { error: "This account is not eligible for the welcome video offer." },
      { status: 409 }
    );
  }

  await addBonusCredits({
    profileId: profile.id,
    amount: creditAmount,
    idempotencyKey: welcomeVideoClaimIdempotencyKey(profile.id),
    description: "Welcome bonus — claimed",
    metadata: { source: "welcome_video_claim" },
  });

  return NextResponse.json({
    granted: true,
    creditAmount,
    href: skillHref(WELCOME_VIDEO_SKILL_ID),
  });
}
