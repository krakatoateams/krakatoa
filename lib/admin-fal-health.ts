/**
 * Fal health for the admin monitoring banner. Pure (no Supabase, no clock), so the page
 * can import it and `npx tsx lib/admin-fal-health.ts` runs the self-check.
 */

/** Fal reports an empty or locked account as a 403 "exhausted balance" / "locked" error. */
const FAL_BALANCE_ERROR = /exhausted balance|insufficient (balance|funds)|account (is )?locked|user is locked/i;

/** Mirrors PROVIDER_OUTCOME_UNRESOLVED_CODE (kept literal so this file stays dependency-free). */
const UNRESOLVED_CODE = "PROVIDER_OUTCOME_UNRESOLVED";

/**
 * Failed jobs run on Fal in the rows given, how many look like an empty account, and how many held
 * credits that reconcile could not confirm within its lookback (needs manual review).
 */
export function summarizeFalFailures(
  rows: { provider: string | null; status: string; error: unknown; errorCode?: string | null; spentCredits?: number; refundedCredits?: number }[]
): { failed: number; balanceSuspect: number; unresolved: number } {
  let failed = 0;
  let balanceSuspect = 0;
  let unresolved = 0;
  for (const r of rows) {
    if (r.provider !== "fal" || r.status !== "failed") continue;
    failed += 1;
    if (r.errorCode === UNRESOLVED_CODE && (r.spentCredits ?? 0) > (r.refundedCredits ?? 0)) unresolved += 1;
    if (FAL_BALANCE_ERROR.test(JSON.stringify(r.error ?? ""))) balanceSuspect += 1;
  }
  return { failed, balanceSuspect, unresolved };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`adminFalHealthSelfCheck: ${msg}`);
}

if (require.main === module) {
  const s = summarizeFalFailures([
    { provider: "fal", status: "failed", error: { message: "Exhausted balance. Top up at fal.ai/dashboard/billing" } },
    { provider: "fal", status: "failed", error: { message: "Fal did not return a valid image URL." } },
    { provider: "fal", status: "succeeded", error: null },
    { provider: "replicate", status: "failed", error: { message: "Exhausted balance" } },
    { provider: null, status: "failed", error: null },
  ]);
  assert(s.failed === 2 && s.balanceSuspect === 1, "counts only failed Fal jobs; balance errors split out");
  const u = summarizeFalFailures([
    { provider: "fal", status: "failed", error: null, errorCode: UNRESOLVED_CODE, spentCredits: 5, refundedCredits: 0 },
    { provider: "fal", status: "failed", error: null, errorCode: UNRESOLVED_CODE, spentCredits: 5, refundedCredits: 5 },
    { provider: "fal", status: "failed", error: null, errorCode: "PROVIDER_OUTCOME_UNKNOWN", spentCredits: 5, refundedCredits: 0 },
  ]);
  assert(u.unresolved === 1, "only unrefunded unresolved jobs are counted");
  assert(summarizeFalFailures([]).failed === 0, "empty input is all clear");
  console.log("adminFalHealthSelfCheck: ok");
}
