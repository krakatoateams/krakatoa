import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { unauthenticatedProviderHttp } from "@/lib/provider-route-auth-pure";
import { claimWelcomeVideoOffer } from "@/lib/welcome-video-offer";
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
 * Eligibility + first-job check + grant run in one RPC under a profile
 * row lock (see krakatoa_claim_welcome_video_offer). Job inserts take the
 * same lock, so this cannot grant after the account has already generated.
 */
export async function POST() {
  let profile;
  try {
    profile = await requireCurrentProfile();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (/not authenticated/i.test(message)) {
      const denied = unauthenticatedProviderHttp();
      return NextResponse.json({ error: denied.error }, { status: denied.status });
    }
    throw e;
  }

  const result = await claimWelcomeVideoOffer(profile.id);
  if (!result.granted || result.creditAmount <= 0) {
    return NextResponse.json(
      { error: "This account is not eligible for the welcome video offer." },
      { status: 409 }
    );
  }

  return NextResponse.json({
    granted: true,
    creditAmount: result.creditAmount,
    href: skillHref(WELCOME_VIDEO_SKILL_ID),
  });
}
