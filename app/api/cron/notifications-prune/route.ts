import { NextRequest, NextResponse } from "next/server";
import { cronAuthorizationFailure } from "@/lib/cron-auth";
import { errorLogSafe } from "@/lib/error-log-safe";
import {
  NOTIFICATION_RETENTION_DAYS,
  pruneNotificationsBefore,
} from "@/lib/notifications-db";

// A single indexed DELETE — comfortable headroom.
export const maxDuration = 60;

/**
 * GET /api/cron/notifications-prune
 *
 * Retention for in-app Notifications: deletes rows older than
 * NOTIFICATION_RETENTION_DAYS. Notifications are informational only (no
 * billing or audit role), so nothing else depends on them.
 *
 * Protection: deployed environments require CRON_SECRET and its Bearer header.
 * Local development may omit the secret.
 *
 * Schedule via vercel.json crons (daily).
 */
export async function GET(req: NextRequest) {
  const authFailure = cronAuthorizationFailure(req);
  if (authFailure) return authFailure;

  const cutoff = new Date(
    Date.now() - NOTIFICATION_RETENTION_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  try {
    const deleted = await pruneNotificationsBefore(cutoff);
    console.log(`[notifications-prune] cutoff=${cutoff} deleted=${deleted}`);
    return NextResponse.json({ ok: true, cutoff, deleted });
  } catch (error: unknown) {
    console.error("[notifications-prune] failed:", errorLogSafe(error));
    return NextResponse.json({ error: "Failed to prune notifications." }, { status: 500 });
  }
}
