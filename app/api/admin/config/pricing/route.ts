import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { listPricingConfigs } from "@/lib/pricing-configs-db";

// List all pricing configs (admin only). NOTE: generation routes do not read
// these values in Phase Admin 1 — see lib/pricing-configs-db.ts.
export const dynamic = "force-dynamic";

export async function GET() {
  return withAdmin(async () => {
    const pricing = await listPricingConfigs();
    return NextResponse.json({ pricing });
  });
}
