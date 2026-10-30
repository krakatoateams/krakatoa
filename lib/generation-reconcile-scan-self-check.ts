/**
 * Self-check for the held-credit reconcile scan over Fal jobs settled `PROVIDER_OUTCOME_UNKNOWN`:
 * paging, budget, overlapping runs, window edges, expiry. Uses the REAL scan/settlement functions
 * with an in-memory job table, Fal and ledger. Run: `npx tsx lib/generation-reconcile-scan-self-check.ts`.
 */
import {
  SETTLED_LOOKBACK_MS,
  expireSettledJob,
  photoRefundIdempotencyKey,
  reconcileSettledProviderFailure,
  scanSettledJobs,
  settledWindows,
  withTimeout,
  type SettledCandidate,
  type SettledFailureOps,
} from "./generation-reconcile-settled";
import { PROVIDER_OUTCOME_UNKNOWN_CODE, PROVIDER_OUTCOME_UNRESOLVED_CODE } from "./generation-client-error";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`reconcileScanSelfCheck: ${msg}`);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const T0 = Date.parse("2026-11-01T05:00:00.000Z");

type FalFate = "failed" | "succeeded" | "unreachable";
type Row = { id: string; updatedAt: number; code: string; fal: FalFate };

function world(rows: Row[]) {
  const refunds = new Map<string, number>(); // idempotency key -> count of ledger applications
  const falCalls = { n: 0 };
  const ops: SettledFailureOps = {
    refundedAmount: async (id) => (refunds.has(photoRefundIdempotencyKey(id)) ? 5 : 0),
    spendAmount: async () => 5,
    getRequestId: async (_p, id) => `req-${id}`,
    isCommitLocked: async () => true,
    confirmsFailure: async (_p, requestId) => {
      falCalls.n += 1;
      return rows.find((r) => `req-${r.id}` === requestId)!.fal === "failed";
    },
    refund: async (p) => {
      if (!refunds.has(p.idempotencyKey)) refunds.set(p.idempotencyKey, 0);
      refunds.set(p.idempotencyKey, refunds.get(p.idempotencyKey)! + 1);
    },
  };
  const markUnresolved = async (j: { id: string }) => {
    const r = rows.find((x) => x.id === j.id)!;
    if (r.code === PROVIDER_OUTCOME_UNKNOWN_CODE) r.code = PROVIDER_OUTCOME_UNRESOLVED_CODE;
  };
  const deps = (w: { after: string; before: string }) => {
    const matching = (cursor: { updatedAt: string; id: string } | null) =>
      rows
        .filter((r) => r.code === PROVIDER_OUTCOME_UNKNOWN_CODE && r.updatedAt > Date.parse(w.after) && r.updatedAt < Date.parse(w.before))
        .map((r): SettledCandidate => ({ id: r.id, profileId: "p", costCredits: 5, updatedAt: new Date(r.updatedAt).toISOString() }))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : a.id < b.id ? -1 : 1))
        .filter((c) => !cursor || c.updatedAt > cursor.updatedAt || (c.updatedAt === cursor.updatedAt && c.id > cursor.id));
    return {
      fetchPage: async (cursor: { updatedAt: string; id: string } | null, limit: number) => matching(cursor).slice(0, limit),
      countFrom: async (cursor: { updatedAt: string; id: string } | null) => matching(cursor).length,
    };
  };
  /** One cron run at `now`, mirroring runGenerationReconcile's composition. */
  const run = async (now: number, opts?: Parameters<typeof scanSettledJobs>[1] & { clock?: () => number }) => {
    const w = settledWindows(now);
    const active = await scanSettledJobs(
      { ...deps(w.active), process: (j) => reconcileSettledProviderFailure(ops, j), now: opts?.clock },
      opts,
    );
    const expired = await scanSettledJobs(
      { ...deps(w.expired), process: (j) => expireSettledJob(ops, markUnresolved, j), now: opts?.clock },
      opts,
    );
    return { active, expired };
  };
  const refundedJobs = () => [...refunds.keys()].length;
  return { rows, refunds, falCalls, run, refundedJobs, ops };
}

async function main() {
  // 1. >50 held jobs: every one is processed across pages (and parallel calls stay capped).
  {
    const rows: Row[] = Array.from({ length: 130 }, (_, i) => ({ id: `j${String(i).padStart(3, "0")}`, updatedAt: T0 - 2 * HOUR - i * 1000, code: PROVIDER_OUTCOME_UNKNOWN_CODE, fal: "failed" as const }));
    const w = world(rows);
    const r = await w.run(T0);
    assert(r.active.scanned === 130 && r.active.outcomes.refunded === 130 && r.active.left === 0, "130 held jobs all refunded across 3 pages");
    assert(w.refundedJobs() === 130 && [...w.refunds.values()].every((n) => n === 1), "exactly one refund each");
    await w.run(T0 + 24 * HOUR); // next day: overlapping window, nothing double refunds
    assert([...w.refunds.values()].every((n) => n === 1), "re-run does not double refund");
  }

  // 2. Budget exhausted: leftovers are counted and finished by the next run.
  {
    const rows: Row[] = Array.from({ length: 40 }, (_, i) => ({ id: `b${String(i).padStart(2, "0")}`, updatedAt: T0 - 2 * HOUR - i * 1000, code: PROVIDER_OUTCOME_UNKNOWN_CODE, fal: "failed" as const }));
    const w = world(rows);
    let t = 0;
    const clock = () => (t += 10); // each check "costs" 10 ms; budget allows 3 batches of 4
    const r = await w.run(T0, { pageSize: 15, concurrency: 4, budgetMs: 35, clock });
    assert(r.active.left > 0 && r.active.scanned + r.active.left === 40, "budget stop reports how many are left");
    assert(w.refundedJobs() === r.active.scanned, "only the visited batch was refunded");
    const r2 = await w.run(T0 + 24 * HOUR);
    assert(w.refundedJobs() === 40 && r2.active.left === 0 && [...w.refunds.values()].every((n) => n === 1), "next run finishes the rest, one refund each");
  }

  // 3. Fal unreachable on run 1, confirms failure on run 2 => exactly one refund.
  {
    const w = world([{ id: "o1", updatedAt: T0 - 3 * HOUR, code: PROVIDER_OUTCOME_UNKNOWN_CODE, fal: "unreachable" }]);
    await w.run(T0);
    assert(w.refundedJobs() === 0 && w.rows[0].code === PROVIDER_OUTCOME_UNKNOWN_CODE, "unreachable Fal: no refund, still held");
    w.rows[0].fal = "failed";
    await w.run(T0 + 24 * HOUR);
    await w.run(T0 + 24 * HOUR); // overlapping/duplicate run
    await w.run(T0 + 48 * HOUR);
    assert(w.refunds.get(photoRefundIdempotencyKey("o1")) === 1, "refunded exactly once under the route's shared key");
  }

  // 4. Failed 1 minute before the run: left for the next run, which picks it up.
  {
    const w = world([{ id: "f1", updatedAt: T0 - MIN, code: PROVIDER_OUTCOME_UNKNOWN_CODE, fal: "failed" }]);
    const r1 = await w.run(T0);
    assert(r1.active.scanned === 0 && w.refundedJobs() === 0, "too-fresh job not scanned this run");
    const r2 = await w.run(T0 + 24 * HOUR);
    assert(r2.active.scanned === 1 && w.refundedJobs() === 1, "picked up on the next run");
  }

  // 5. Older than the lookback: not rescanned as active; one last attempt, then honest unresolved.
  {
    const old = T0 - SETTLED_LOOKBACK_MS - HOUR;
    const w = world([
      { id: "x1", updatedAt: old, code: PROVIDER_OUTCOME_UNKNOWN_CODE, fal: "unreachable" },
      { id: "x2", updatedAt: old + 1000, code: PROVIDER_OUTCOME_UNKNOWN_CODE, fal: "failed" },
      { id: "x3", updatedAt: old + 2000, code: PROVIDER_OUTCOME_UNKNOWN_CODE, fal: "succeeded" },
    ]);
    const r = await w.run(T0);
    assert(r.active.scanned === 0, "expired jobs are not in the active scan");
    assert(w.rows[0].code === PROVIDER_OUTCOME_UNRESOLVED_CODE && w.rows[2].code === PROVIDER_OUTCOME_UNRESOLVED_CODE, "unconfirmed expired jobs marked unresolved");
    assert(w.rows[1].code === PROVIDER_OUTCOME_UNKNOWN_CODE && w.refunds.get(photoRefundIdempotencyKey("x2")) === 1, "last-chance confirm still refunds");
    assert(!w.refunds.has(photoRefundIdempotencyKey("x1")) && !w.refunds.has(photoRefundIdempotencyKey("x3")), "unresolved jobs are not refunded");
    const calls = w.falCalls.n;
    await w.run(T0 + 24 * HOUR);
    assert(w.falCalls.n === calls && w.rows[0].code === PROVIDER_OUTCOME_UNRESOLVED_CODE, "unresolved jobs are not re-checked again (refunded one is only re-skipped)");
  }

  // 6. Fal succeeded / produced output: never refunded while held.
  {
    const w = world([{ id: "s1", updatedAt: T0 - 2 * HOUR, code: PROVIDER_OUTCOME_UNKNOWN_CODE, fal: "succeeded" }]);
    await w.run(T0);
    await w.run(T0 + 24 * HOUR);
    assert(w.refundedJobs() === 0, "succeeded run is never refunded");
  }

  // 7. A throwing job is recorded and does not stop the scan.
  {
    const w = world([
      { id: "e1", updatedAt: T0 - 2 * HOUR, code: PROVIDER_OUTCOME_UNKNOWN_CODE, fal: "failed" },
      { id: "e2", updatedAt: T0 - 2 * HOUR + 1, code: PROVIDER_OUTCOME_UNKNOWN_CODE, fal: "failed" },
    ]);
    const r = await scanSettledJobs({
      ...{ fetchPage: async (c: unknown, l: number) => (c ? [] : [
        { id: "e1", profileId: "p", costCredits: 5, updatedAt: "a" }, { id: "e2", profileId: "p", costCredits: 5, updatedAt: "b" },
      ].slice(0, l)), countFrom: async () => 0 },
      process: async (j) => { if (j.id === "e1") throw new Error("boom"); return reconcileSettledProviderFailure(w.ops, j); },
    });
    assert(r.errors.length === 1 && r.outcomes.refunded === 1 && r.scanned === 2, "error is isolated");
  }

  // 8. Per-call timeout: a slow Fal counts as not confirmed.
  {
    const slow = new Promise<boolean>((res) => setTimeout(() => res(true), 200));
    assert((await withTimeout(slow, 10, false)) === false, "slow call times out to fallback");
    assert((await withTimeout(Promise.resolve(true), 50, false)) === true, "fast call passes through");
    assert((await withTimeout(Promise.reject(new Error("x")), 50, false)) === false, "rejection maps to fallback");
  }

  // 9. Held job that already got a batch partial refund: reconcile refunds only the remainder, once.
  {
    const ledger = { refunded: 5, keys: new Set<string>() }; // spent 10 (2 images), 1 removed image refunded earlier
    const ops9: SettledFailureOps = {
      refundedAmount: async () => ledger.refunded,
      spendAmount: async () => 10,
      getRequestId: async () => "req",
      isCommitLocked: async () => true,
      confirmsFailure: async () => true,
      refund: async (p) => { if (!ledger.keys.has(p.idempotencyKey)) { ledger.keys.add(p.idempotencyKey); ledger.refunded += p.amount; } },
    };
    const job = { id: "b1", profileId: "p", costCredits: 10 };
    assert((await reconcileSettledProviderFailure(ops9, job)) === "refunded" && ledger.refunded === 10, "remainder refunded");
    assert((await reconcileSettledProviderFailure(ops9, job)) === "already_refunded" && ledger.refunded === 10 && ledger.keys.size === 1, "double run refunds once");
    assert(ledger.keys.has(`${photoRefundIdempotencyKey("b1")}:remainder`), "remainder uses its own stable key");
    ops9.confirmsFailure = async () => false;
    ledger.refunded = 5; ledger.keys.clear();
    assert((await reconcileSettledProviderFailure(ops9, job)) === "skipped" && ledger.refunded === 5, "unconfirmed remainder stays held");
  }

  console.log("reconcileScanSelfCheck: ok");
}
void main();
