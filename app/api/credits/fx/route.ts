import { NextResponse } from "next/server";
import { getBillingSettings } from "@/lib/billing-settings-db";

export const dynamic = "force-dynamic";

/** Public IDR-per-USD rate for pack price labels. No other billing knobs. */
export async function GET() {
  const usdToIdr = (await getBillingSettings()).usdToIdr;
  return NextResponse.json(
    { usdToIdr: Number.isFinite(usdToIdr) && usdToIdr > 0 ? usdToIdr : null },
    { headers: { "Cache-Control": "public, max-age=60" } }
  );
}
