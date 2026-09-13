import { NextRequest, NextResponse } from "next/server";
import { expireCreditLots } from "@/lib/credits-db";
import { errorLogSafe } from "@/lib/error-log-safe";
import { cronAuthorizationFailure } from "@/lib/cron-auth";

// Ledger writes + wallet updates per expired lot — give it headroom.
export const maxDuration = 120;

/**
 * GET /api/cron/credit-expiry
 *
 * Expires credit lots whose expires_at has passed: writes one `expiry` ledger
 * row per lot and reduces the cached wallet balance. See Expiry Management.
 *
 * Query params:
 *   - dryRun=1 → report the counts that WOULD expire, mutate nothing.
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
    const result = await expireCreditLots({ dryRun });
    console.log(
      `[credit-expiry] dryRun=${dryRun} lots=${result.lots_expired} ` +
        `credits=${result.credits_expired} profiles=${result.profiles_affected}`
    );
    return NextResponse.json(result);
  } catch (err) {
    console.error("[credit-expiry]", errorLogSafe(err));
    return NextResponse.json(
      { error: "Credit expiry failed." },
      { status: 500 }
    );
  }
}
