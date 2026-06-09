import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getAdminSummary } from "@/lib/admin-metrics-db";

// Read-only admin overview metrics. Uses existing DB data only — no provider
// calls, no mutations.
export const dynamic = "force-dynamic";

export async function GET() {
  return withAdmin(async () => {
    const summary = await getAdminSummary();
    return NextResponse.json(summary);
  });
}
