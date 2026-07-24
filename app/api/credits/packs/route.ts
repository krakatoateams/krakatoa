import { NextResponse } from "next/server";
import { listActiveCreditPacks } from "@/lib/credit-packs-db";

export const dynamic = "force-dynamic";

/**
 * GET /api/credits/packs — active purchasable credit tiers.
 *
 * Public (no auth): powers the in-app Buy panel and the public landing pricing.
 * Reads via the service role and returns only active tiers, sorted. Never throws
 * (falls back to the built-in defaults) so the buy UI always renders.
 */
export async function GET() {
  const packs = await listActiveCreditPacks();
  return NextResponse.json(
    { packs },
    { headers: { "Cache-Control": "no-store, max-age=0" } }
  );
}
