import { NextResponse } from "next/server";
import { getUsdCheckoutSettings } from "@/lib/usd-checkout-settings-db";

export const dynamic = "force-dynamic";

/** Public flag for whether customers may see and buy USD packs. */
export async function GET() {
  const settings = await getUsdCheckoutSettings();
  return NextResponse.json(
    { enabled: settings.enabled },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
