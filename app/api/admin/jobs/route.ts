import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getAdminJobs } from "@/lib/admin-metrics-db";

// Read-only recent jobs list (optionally filtered by ?tool= and ?status=).
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withAdmin(async () => {
    const { searchParams } = new URL(req.url);
    const tool = searchParams.get("tool") ?? undefined;
    const status = searchParams.get("status") ?? undefined;
    const limitRaw = searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;

    const jobs = await getAdminJobs({
      tool,
      status,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json({ jobs });
  });
}
