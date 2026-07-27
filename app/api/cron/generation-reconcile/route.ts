import { NextRequest, NextResponse } from "next/server";
import { runGenerationReconcile } from "@/lib/generation-reconcile";

export const maxDuration = 120;

/**
 * GET /api/cron/generation-reconcile
 *
 * Refunds stuck `running` jobs and closes stale `generation_requests` rows
 * (e.g. after Vercel function timeout without catch).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  try {
    const result = await runGenerationReconcile();
    console.log(
      `[generation-reconcile] staleJobs=${result.staleJobs} refunded=${result.refundedJobs} staleRequests=${result.staleRequests}`
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation reconcile failed.";
    console.error("[generation-reconcile]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
