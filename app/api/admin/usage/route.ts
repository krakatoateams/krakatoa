import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getAdminUsage } from "@/lib/admin-metrics-db";

// Read-only usage aggregates from usage_events. No provider calls.
export const dynamic = "force-dynamic";

export async function GET() {
  return withAdmin(async () => {
    const usage = await getAdminUsage();
    return NextResponse.json(usage);
  });
}
