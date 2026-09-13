import { NextRequest, NextResponse } from "next/server";
import { runGenerationReconcile } from "@/lib/generation-reconcile";
import { errorLogSafe } from "@/lib/error-log-safe";
import { cronAuthorizationFailure } from "@/lib/cron-auth";

export const maxDuration = 120;

/**
 * GET /api/cron/generation-reconcile
 *
 * Refunds stuck `running` jobs and closes stale `generation_requests` rows
 * (e.g. after Vercel function timeout without catch).
 * Deployed environments require CRON_SECRET and its Bearer header.
 */
export async function GET(req: NextRequest) {
  const authFailure = cronAuthorizationFailure(req);
  if (authFailure) return authFailure;

  try {
    const result = await runGenerationReconcile();
    console.log(
      `[generation-reconcile] staleJobs=${result.staleJobs} refunded=${result.refundedJobs} settledWorkflow=${result.settledWorkflowJobs} liveWorkflow=${result.liveWorkflowJobs} staleRequests=${result.staleRequests} expiredRecoverable=${result.expiredRecoverable} swept=${result.sweptResumableFolders}`
    );
    return NextResponse.json({
      ...result,
      errors: result.errors.map(errorLogSafe),
    });
  } catch (err) {
    console.error("[generation-reconcile]", errorLogSafe(err));
    return NextResponse.json(
      { error: "Generation reconcile failed." },
      { status: 500 }
    );
  }
}
