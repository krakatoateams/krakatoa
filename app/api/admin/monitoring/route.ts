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
    const windowRaw = Number(searchParams.get("window"));
    const limitRaw = Number(searchParams.get("limit"));

    const [monitoring, failedSteps] = await Promise.all([
      getAdminMonitoring({
        windowHours: Number.isFinite(windowRaw) ? windowRaw : undefined,
        tool: searchParams.get("tool") ?? undefined,
        status: searchParams.get("status") ?? undefined,
        flag: FLAGS.find((f) => f === flagRaw),
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
      }),
      getAdminFailedStepAggregates({
        windowHours: Number.isFinite(windowRaw) ? windowRaw : undefined,
      }),
    ]);

    return NextResponse.json({ ...monitoring, failedSteps });
  });
}
