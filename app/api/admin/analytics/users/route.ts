import { NextResponse, type NextRequest } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getNewUsers } from "@/lib/admin-analytics-db";
import { readPageParams } from "@/lib/admin-page-params";

// Newest registered users, paginated. Read-only.
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return withAdmin(async () => {
    const { limit, offset } = readPageParams(req);
    const page = await getNewUsers({ limit, offset });
    return NextResponse.json(page);
  });
}
