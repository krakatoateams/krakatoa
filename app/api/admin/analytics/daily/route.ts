import { NextResponse, type NextRequest } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getDailyMetrics } from "@/lib/admin-analytics-db";
import { readPageParams } from "@/lib/admin-page-params";

// Daily rollup (sales + active users), paginated newest day first. Read-only.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAdmin(async () => {
    const { limit, offset } = readPageParams(req);
    const page = await getDailyMetrics({ limit, offset });
    return NextResponse.json(page);
  });
}
