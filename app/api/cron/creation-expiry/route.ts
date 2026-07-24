import { NextRequest, NextResponse } from "next/server";
import { runAllCreationExpiry } from "@/lib/creation-expiry";

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
 * Protection: when CRON_SECRET is set, requests must include
 *   Authorization: Bearer <CRON_SECRET>
 * When CRON_SECRET is absent (local dev), all requests are allowed.
 *
 * Scheduled via vercel.json crons (daily).
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
  }

  const { searchParams } = new URL(req.url);
  const dryRun = searchParams.get("dryRun") === "1";

  try {
    const results = await runAllCreationExpiry({ dryRun });
    for (const r of results) {
      console.log(
        `[creation-expiry] target=${r.target} dryRun=${dryRun} skipped=${r.skipped} ` +
          `days=${r.days} scanned=${r.scanned} deleted=${r.deletedRows}`
      );
    }
    return NextResponse.json({ dryRun, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Creation expiry failed.";
    console.error("[creation-expiry]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
