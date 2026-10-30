/**
 * Fal health for the admin monitoring banner. Pure (no Supabase, no clock), so the page
 * can import it and `npx tsx lib/admin-fal-health.ts` runs the self-check.
 */

/** Fal reports an empty or locked account as a 403 "exhausted balance" / "locked" error. */
const FAL_BALANCE_ERROR = /exhausted balance|insufficient (balance|funds)|account (is )?locked|user is locked/i;

/** Failed jobs run on Fal in the rows given, and how many look like an empty account. */
export function summarizeFalFailures(
  rows: { provider: string | null; status: string; error: unknown }[]
): { failed: number; balanceSuspect: number } {
  let failed = 0;
  let balanceSuspect = 0;
  for (const r of rows) {
    if (r.provider !== "fal" || r.status !== "failed") continue;
    failed += 1;
    if (FAL_BALANCE_ERROR.test(JSON.stringify(r.error ?? ""))) balanceSuspect += 1;
  }
  return { failed, balanceSuspect };
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
  assert(summarizeFalFailures([]).failed === 0, "empty input is all clear");
  console.log("adminFalHealthSelfCheck: ok");
}
