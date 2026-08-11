import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getAdminAnalytics } from "@/lib/admin-analytics-db";

// Read-only analytics aggregates (sales, features, models, packages, countries)
// plus headline totals. Existing DB data only — no provider calls, no mutations.
export const dynamic = "force-dynamic";

export async function GET() {
  return withAdmin(async () => {
    const analytics = await getAdminAnalytics();
    return NextResponse.json(analytics);
  });
}
