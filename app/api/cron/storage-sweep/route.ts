import { NextRequest, NextResponse } from "next/server";
import { runStorageSweep, DEFAULT_SWEEP_MIN_AGE_HOURS } from "@/lib/storage-sweep";

// Listing + reference scan + batched deletes — give it headroom.
export const maxDuration = 120;

/**
 * GET /api/cron/storage-sweep
 *
 * Removes transient (`videos/temp/`) and orphaned `videos/` objects older than
 * the age threshold so the Supabase bucket self-heals. See
 * openspec/changes/storage-hygiene.
 *
 * Query params:
 *   - dryRun=1        → report the plan, delete nothing
 *   - minAgeHours=NN  → override the safety age threshold (default 24)
 *
 * Protection: when CRON_SECRET is set, requests must include
 *   Authorization: Bearer <CRON_SECRET>
 * When CRON_SECRET is absent (local dev), all requests are allowed.
 *
 * Schedule via vercel.json crons (daily); the 24h threshold tolerates a
 * once-daily cadence. Safe to trigger manually for the first verified run.
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

  // Number(null) is 0 (finite, >= 0), so a naive Number(searchParams.get(...))
  // would silently turn "param absent" into "minAgeHours=0" instead of falling
  // back to the default — disabling the age guard on every unparameterized
  // call (i.e. every automatic daily cron tick, since vercel.json's cron entry
  // never passes minAgeHours). Check for absence explicitly first.
  const minAgeHoursParam = searchParams.get("minAgeHours");
  const rawAge = minAgeHoursParam === null ? NaN : Number(minAgeHoursParam);
  const minAgeHours =
    Number.isFinite(rawAge) && rawAge >= 0 ? rawAge : DEFAULT_SWEEP_MIN_AGE_HOURS;

  try {
    const result = await runStorageSweep({ dryRun, minAgeHours });

    console.log(
      `[storage-sweep] dryRun=${dryRun} minAgeHours=${minAgeHours} ` +
        `scanned=${result.totals.scanned} deletable=${result.deletable.length} ` +
        `deleted=${result.deletedCount} reclaimedBytes=${result.reclaimedBytes}`,
    );

    return NextResponse.json({
      dryRun: result.dryRun,
      minAgeHours: result.minAgeHours,
      scanned: result.totals.scanned,
      keptReferenced: result.keep.length,
      deletableCount: result.deletable.length,
      deletedCount: result.deletedCount,
      reclaimableBytes: result.totals.deletableBytes,
      reclaimedBytes: result.reclaimedBytes,
      deletable: result.deletable.map((o) => ({
        path: o.path,
        size: o.size,
        reason: o.reason,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Storage sweep failed.";
    console.error("[storage-sweep]", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
