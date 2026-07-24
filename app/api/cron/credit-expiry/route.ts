import { NextRequest, NextResponse } from "next/server";
import { expireCreditLots } from "@/lib/credits-db";

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
    const result = await expireCreditLots({ dryRun });
    console.log(
      `[credit-expiry] dryRun=${dryRun} lots=${result.lots_expired} ` +
        `credits=${result.credits_expired} profiles=${result.profiles_affected}`
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Credit expiry failed.";
    console.error("[credit-expiry]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
