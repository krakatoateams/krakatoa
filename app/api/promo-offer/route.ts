import { NextResponse } from "next/server";
import { getWelcomeOfferSettings } from "@/lib/welcome-offer-settings-db";
import { isPromoLive } from "@/lib/promo-offer";

export const dynamic = "force-dynamic";

/**
 * GET /api/promo-offer — public read for the dashboard promo popup gate.
 *
 * `live` combines the code-level master switch + deadline (isPromoLive) with the
 * admin-configurable DB toggle, so the dashboard only auto-opens the promo when
 * all conditions hold. Presentational only — no billing implications.
 */
export async function GET() {
  const { enabled } = await getWelcomeOfferSettings();
  return NextResponse.json({ enabled, live: enabled && isPromoLive() });
}
