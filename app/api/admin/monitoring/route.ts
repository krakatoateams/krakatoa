import { NextResponse } from "next/server";
import { withAdmin } from "@/lib/admin-api";
import { getAdminMonitoring, getAdminFailedStepAggregates } from "@/lib/admin-monitoring-db";
import type { JobFlag } from "@/lib/admin-monitoring-flags";

// Read-only cross-user generation monitoring. Never mutates anything.
export const dynamic = "force-dynamic";

const FLAGS: JobFlag[] = ["stuck", "cancel_not_honored", "refund_missing"];

export async function GET(req: Request) {
  return withAdmin(async () => {
    const { searchParams } = new URL(req.url);
    const flagRaw = searchParams.get("flag");
    // A missing param yields Number(null) === 0, which is finite — so `|| undefined`
    // rather than isFinite, otherwise an absent `limit` becomes .limit(0) (no rows).
    const windowHours = Number(searchParams.get("window")) || undefined;
    const limit = Number(searchParams.get("limit")) || undefined;

    const [monitoring, failedSteps] = await Promise.all([
      getAdminMonitoring({
        windowHours,
        tool: searchParams.get("tool") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        flag: FLAGS.find((f) => f === flagRaw),
        limit,
      }),
      getAdminFailedStepAggregates({ windowHours }),
    ]);

    return NextResponse.json({ ...monitoring, failedSteps });
  });
}
