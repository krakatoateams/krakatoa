import { NextResponse } from "next/server";
import { requireCurrentProfile } from "@/lib/profiles-db";
import { getWelcomeVideoOfferEligibility } from "@/lib/welcome-video-offer";
import { WELCOME_VIDEO_SKILL_ID, skillHref } from "@/lib/skills";

export const dynamic = "force-dynamic";

/**
 * GET /api/welcome-video-offer — read for the "claim your free video"
 * card/popup. See lib/welcome-video-offer.ts for the eligibility rule.
 * Distinct from /api/promo-offer, which gates the unrelated credit-pack
 * discount popup.
 *
 * Uses requireCurrentProfile (creates the profile row on first use), NOT
 * getCurrentProfile (read-only, returns null until some route has lazily
 * created it). A brand-new signup has no profiles row yet until the first
 * route that calls requireCurrentProfile runs — this popup/card's own
 * eligibility check was previously that read-only check, so on a fresh
 * account it could race ahead of profile creation, see "no profile", report
 * ineligible, and never retry (each surface fetches once). Confirmed via a
 * real test account where the popup fired for an old dormant account
 * (profile already existed) but not for a same-session fresh signup.
 */
export async function GET() {
  let profile;
  try {
    profile = await requireCurrentProfile();
  } catch {
    return NextResponse.json({ eligible: false });
  }

  const { eligible, creditAmount } = await getWelcomeVideoOfferEligibility(profile.id);
  return NextResponse.json({
    eligible,
    creditAmount,
    href: skillHref(WELCOME_VIDEO_SKILL_ID),
  });
}
