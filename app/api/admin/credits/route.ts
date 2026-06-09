import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getAdminCredits } from "@/lib/admin-metrics-db";

// Read-only recent credit transactions + top users by lifetime spend.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return withAdmin(async () => {
    const { searchParams } = new URL(req.url);
    const limitRaw = searchParams.get("limit");
    const limit = limitRaw ? Number(limitRaw) : undefined;

    const credits = await getAdminCredits({
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return NextResponse.json(credits);
  });
}
