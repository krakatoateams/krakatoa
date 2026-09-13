import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";
import { cronAuthorizationFailure } from "@/lib/cron-auth";
import { errorLogSafe } from "@/lib/error-log-safe";
import { InstagramRefreshError, refreshLongLivedToken } from "@/lib/instagram";
import {
  instagramRefreshIsTransient,
  instagramRefreshLogSafe,
  instagramRefreshWindowEndIso,
  instagramRefreshedTokenRow,
  instagramTokenDueForRefresh,
} from "@/lib/instagram-refresh-pure";

export const maxDuration = 120;

/**
 * GET /api/cron/instagram-token-refresh
 *
 * Proactively refreshes Instagram long-lived access tokens whose expires_at
 * falls inside the next 14 days (design.md Decision 2b). Tokens younger than
 * 24 hours are skipped. Graph errors leave the row in place.
 *
 * Protection: deployed environments require CRON_SECRET and its Bearer header.
 * Local development may omit the secret.
 *
 * Scheduled via vercel.json crons (daily).
 */
export async function GET(req: NextRequest) {
  const authFailure = cronAuthorizationFailure(req);
  if (authFailure) return authFailure;

  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const windowEnd = instagramRefreshWindowEndIso(nowMs);

  const { data: rows, error } = await supabaseServer
    .from("platform_tokens")
    .select("user_id, access_token, expires_at, created_at")
    .eq("platform", "instagram")
    .gt("expires_at", nowIso)
    .lte("expires_at", windowEnd);

  if (error) {
    console.error("[instagram-token-refresh] select failed:", error.message);
    return NextResponse.json({ error: "Instagram token refresh failed." }, { status: 500 });
  }

  let considered = 0;
  let refreshed = 0;
  let skippedYoung = 0;
  let transient = 0;
  let permanent = 0;

  for (const row of rows ?? []) {
    considered += 1;
    const expiresAtMs = Date.parse(row.expires_at);
    const createdAtMs = row.created_at ? Date.parse(row.created_at) : undefined;
    if (
      !Number.isFinite(expiresAtMs) ||
      !instagramTokenDueForRefresh({ expiresAtMs, nowMs, createdAtMs })
    ) {
      skippedYoung += 1;
      continue;
    }

    try {
      const tokens = await refreshLongLivedToken(row.access_token);
      const persist = instagramRefreshedTokenRow({
        accessToken: tokens.accessToken,
        expiresIn: tokens.expiresIn,
        nowMs: Date.now(),
      });
      const { error: persistErr } = await supabaseServer
        .from("platform_tokens")
        .update({
          access_token: persist.access_token,
          refresh_token: persist.refresh_token,
          expires_at: persist.expires_at,
        })
        .eq("user_id", row.user_id)
        .eq("platform", "instagram");

      if (persistErr) {
        console.error("[instagram-token-refresh] persist failed:", persistErr.message);
        transient += 1;
        continue;
      }
      refreshed += 1;
    } catch (err) {
      const status = err instanceof InstagramRefreshError ? err.httpStatus : 500;
      const detail = instagramRefreshLogSafe(errorLogSafe(err));
      if (instagramRefreshIsTransient(status)) {
        console.error("[instagram-token-refresh] transient Graph error:", detail);
        transient += 1;
      } else {
        console.error(
          "[instagram-token-refresh] permanent Graph error; user must reconnect:",
          detail,
        );
        permanent += 1;
      }
    }
  }

  console.log(
    `[instagram-token-refresh] considered=${considered} refreshed=${refreshed} ` +
      `skippedYoung=${skippedYoung} transient=${transient} permanent=${permanent}`,
  );
  return NextResponse.json({
    considered,
    refreshed,
    skippedYoung,
    transient,
    permanent,
  });
}
