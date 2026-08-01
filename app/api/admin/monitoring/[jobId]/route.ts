import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getAdminJobDetail } from "@/lib/admin-monitoring-db";

// Read-only drill-down for one job: step timeline, credit ledger, cancel state,
// Replicate prediction ids and the recovery manifest.
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { jobId: string } }) {
  return withAdmin(async () => {
    const detail = await getAdminJobDetail(params.jobId);
    if (!detail) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json(detail);
  });
}
