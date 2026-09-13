import { NextRequest, NextResponse } from "next/server";
import { runAllCreationExpiry } from "@/lib/creation-expiry";
import { errorLogSafe } from "@/lib/error-log-safe";
import { cronAuthorizationFailure } from "@/lib/cron-auth";

// Listing + batched storage/row deletes across photos + videos — headroom.
export const maxDuration = 120;

/**
 * GET /api/cron/creation-expiry
 *
 * Deletes user_creations (and their storage objects) older than the admin-
 * configured photo/video retention, and soft-deletes matching platform assets.
 * See Expiry Management. Retention is evaluated from created_at + current config.
 *
 * Query params:
 *   - dryRun=1 → report what WOULD be deleted, mutate nothing.
 *
 * Protection: deployed environments require CRON_SECRET and its Bearer header.
 * Local development may omit the secret.
 *
 * Scheduled via vercel.json crons (daily).
 */
export async function GET(req: NextRequest) {
  const authFailure = cronAuthorizationFailure(req);
  if (authFailure) return authFailure;

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "1";

  try {
    const results = await runAllCreationExpiry({ dryRun });
    for (const r of results) {
      console.log(
        `[creation-expiry] target=${r.target} dryRun=${dryRun} skipped=${r.skipped} ` +
          `days=${r.days} scanned=${r.scanned} deleted=${r.deletedRows} ` +
          `partial=${r.partial} remaining=${r.remaining}`
      );
    }
    return NextResponse.json({ dryRun, results });
  } catch (err) {
    console.error("[creation-expiry]", errorLogSafe(err));
    return NextResponse.json(
      { error: "Creation expiry failed." },
      { status: 500 }
    );
  }
}
