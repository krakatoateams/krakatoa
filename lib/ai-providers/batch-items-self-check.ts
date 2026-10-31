/**
 * S2 phase 2 self-check: per-image settlement of partly delivered multi-image Fal requests
 * (migration 119). REAL: planBatchItemRows, settleBatchItem, scanSettledJobs/settledWindows, the Fal
 * adapter's getPredictionStatus (fake Fal client), the canonical refund policy, batchFailureMessage and
 * the generation_batch_items data module (Supabase answered by a stubbed fetch). Fake: the job table,
 * the item table and a ledger that dedupes idempotency keys like credit_transactions.
 * Run: `npx tsx --conditions=react-server lib/ai-providers/batch-items-self-check.ts`.
 */
import { readFileSync } from "node:fs";
import { ApiError } from "@fal-ai/client";
import {
  GenerationCancelledError,
  ProviderDefinitiveFailureError,
  isGenerationCancelled,
  isProviderDefinitiveFailure,
} from "./errors";
import { createFalPhotoProvider, type FalQueueLike } from "./fal-photo";
import {
  batchItemRefundKey,
  planBatchItemRows,
  settleBatchItem,
  type BatchItemCandidate,
  type BatchItemOps,
  type BatchItemState,
} from "../generation-batch-items-pure";
import { SETTLED_LOOKBACK_MS, scanSettledJobs, settledWindows, type SettledCursor } from "../generation-reconcile-settled";
import { batchFailureMessage, planBatchFailures } from "../photo-batch-failure-pure";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`batchItemsSelfCheck: ${msg}`);
}

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse("2026-11-01T05:00:00.000Z");
const ENDPOINT = "fal-ai/nano-banana";
const fal = { id: "fal", commitsOnSubmit: true, cancelWhileQueued: true };
const replicate = { id: "replicate", commitsOnSubmit: false, cancelWhileQueued: false };
const networkLoss = () => new Error("fetch failed");
const definitive = () => new ProviderDefinitiveFailureError();
const removed = () => new GenerationCancelledError();
const ok = (): PromiseSettledResult<unknown> => ({ status: "fulfilled", value: {} });
const no = (reason: unknown): PromiseSettledResult<unknown> => ({ status: "rejected", reason });

const rowsFor = (provider: typeof fal, outcomes: PromiseSettledResult<unknown>[]) =>
  planBatchItemRows({
    jobId: "job-1",
    profileId: "p-1",
    generationRequestId: "gr-1",
    provider,
    outcomes,
    predictionIds: outcomes.map((_, i) => (i === 3 ? undefined : `r${i}@${ENDPOINT}`)),
    outputUrls: outcomes.map((_, i) => (i === 1 ? "https://v3.fal.media/files/late.png" : undefined)),
    assetIds: outcomes.map((_, i) => `a${i}`),
    delivery: (i) => ({ filename: `f-${i}.jpg`, photoMode: "social" }),
    perImageCredits: 5,
    isDefinitive: isProviderDefinitiveFailure,
    isCancelled: isGenerationCancelled,
    nowIso: new Date(T0).toISOString(),
  });

// 1. Route plan -> rows: one per image, states agree with planBatchFailures, keys, credits, per-index ids.
{
  const outcomes = [ok(), no(networkLoss()), no(definitive()), no(networkLoss())];
  const rows = rowsFor(fal, outcomes)!;
  assert(rows.length === 4 && rows.map((r) => r.batch_index).join() === "0,1,2,3", "one row per image, by index");
  assert(rows.map((r) => r.state).join() === "delivered,ambiguous,failed_definitive,ambiguous", "states");
  const plan = planBatchFailures({ rejections: outcomes.flatMap((o) => (o.status === "rejected" ? [o.reason] : [])), commitsOnSubmit: true, cancelWhileQueued: true, isDefinitive: isProviderDefinitiveFailure, isCancelled: isGenerationCancelled });
  assert(rows.filter((r) => r.state === "ambiguous").length === plan.unconfirmedFailures, "ambiguous rows = phase-1 unconfirmed count");
  assert(rows.every((r) => r.credits === 5 && r.job_id === "job-1" && r.profile_id === "p-1" && r.provider === "fal"), "credits + owner on every row");
  assert(rows[2].refund_idempotency_key === "refund:product_photo:job-1:partial" && rows[1].refund_idempotency_key === null, "definitive row carries the route's :partial key");
  assert(rows[1].prediction_id === `r1@${ENDPOINT}` && rows[3].prediction_id === null, "prediction id per index (none when submit threw)");
  assert(rows[1].output_url === "https://v3.fal.media/files/late.png" && rows[0].output_url === null, "output url only on ambiguous rows");
  assert(rows[1].delivery?.filename === "f-1.jpg" && rows[0].delivery === null && rows[2].delivery === null, "delivery params only on ambiguous rows");
  assert(rows[1].settled_at === null && rows[0].settled_at !== null, "open rows unsettled, terminal rows settled");
  const cancelled = rowsFor(fal, [ok(), no(removed()), no(networkLoss())])!;
  assert(cancelled[1].state === "cancelled_confirmed" && cancelled[1].refund_idempotency_key?.endsWith(":partial") === true, "confirmed removal row");
}

// 2. Scope (I5, I6): no rows for Replicate, a single image, zero successes, or nothing ambiguous.
{
  assert(rowsFor(replicate, [ok(), no(networkLoss())]) === null, "Replicate: no rows");
  assert(rowsFor(fal, [no(networkLoss())]) === null && rowsFor(fal, [ok()]) === null, "single image: no rows");
  assert(rowsFor(fal, [no(networkLoss()), no(definitive())]) === null, "zero successes: job-level path, no rows");
  assert(rowsFor(fal, [ok(), no(definitive()), no(removed())]) === null, "nothing ambiguous: no rows");
}

// 3. Messages: the refund is promised only when the rows exist (recheck); otherwise phase-1 wording.
{
  const phase1 = "2 of 4 images didn't arrive. 1 was refunded. 1 couldn't be confirmed by the AI provider, so it is still charged for now. Contact support if it doesn't appear in your library.";
  assert(batchFailureMessage({ failed: 2, requested: 4, delivered: 2, unconfirmed: 1 }) === phase1, "no recheck: phase-1 text");
  assert(batchFailureMessage({ failed: 2, requested: 4, delivered: 2, unconfirmed: 1, recheck: false }) === phase1, "recheck false: phase-1 text");
  assert(
    batchFailureMessage({ failed: 2, requested: 4, delivered: 2, unconfirmed: 1, recheck: true }) ===
      "2 of 4 images didn't arrive. 1 was refunded. 1 couldn't be confirmed yet, so we're re-checking it with the AI provider: if it failed, the credits come back automatically.",
    "recheck singular",
  );
  assert(
    batchFailureMessage({ failed: 2, requested: 3, delivered: 1, unconfirmed: 2, recheck: true }) ===
      "2 of 3 images didn't arrive. 2 couldn't be confirmed yet, so we're re-checking them with the AI provider: if they failed, the credits come back automatically.",
    "recheck plural",
  );
  assert(
    batchFailureMessage({ failed: 1, requested: 4, delivered: 3, unconfirmed: 0, recheck: true }) ===
      "1 of 4 images couldn't be generated — you were only charged for the 3 that worked.",
    "nothing unconfirmed: today's text",
  );
}

// Fake Fal: per request id fate, answered through the REAL adapter's getPredictionStatus.
type Fate = "failed" | "failed_4xx" | "processing" | "succeeded" | "expired_404" | "server_5xx" | "timeout";
function fakeFal(fates: Map<string, Fate>, calls: { n: number }): FalQueueLike {
  const fate = (id: string) => fates.get(id) ?? "processing";
  return {
    queue: {
      submit: async () => ({ request_id: "unused" }),
      status: async (_e, o) => {
        calls.n += 1;
        const f = fate(o.requestId);
        if (f === "timeout") return new Promise(() => {});
        if (f === "server_5xx") throw new ApiError({ message: "unavailable", status: 503, body: {} });
        if (f === "processing") return { status: "IN_PROGRESS" };
        if (f === "failed") return { status: "COMPLETED", error: "runner failed" };
        return { status: "COMPLETED" };
      },
      result: async (_e, o) => {
        const f = fate(o.requestId);
        if (f === "expired_404") throw new ApiError({ message: "gone", status: 404, body: {} });
        if (f === "failed_4xx") throw new ApiError({ message: "bad", status: 422, body: {} });
        return { data: { images: [{ url: "https://v3.fal.media/files/out.png" }] } };
      },
      cancel: async () => "unknown",
    },
    storage: { upload: async () => "https://v3.fal.media/files/up.png" },
  };
}

type Item = BatchItemCandidate & { state: BatchItemState; fate?: Fate; refundKey: string | null };

function world(items: Item[], jobs: Record<string, { status: string; spend: number; refunded?: number }>) {
  const fates = new Map(items.filter((i) => i.fate).map((i) => [`req-${i.id}`, i.fate!]));
  const falCalls = { n: 0 };
  const provider = createFalPhotoProvider(fakeFal(fates, falCalls), 0);
  const ledger = new Map<string, { jobId: string; amount: number }>(); // idempotency_key unique
  const refundCalls = { n: 0 };
  for (const [jobId, j] of Object.entries(jobs)) if (j.refunded) ledger.set(`refund:product_photo:${jobId}:partial`, { jobId, amount: j.refunded });
  const ops: BatchItemOps = {
    jobStatus: async (_p, jobId) => jobs[jobId]?.status ?? null,
    // Mirrors runGenerationReconcile: only commit-on-submit providers are asked.
    predictionStatus: async (providerId, id) => (providerId === "fal" ? (await provider.getPredictionStatus(id)).status : "unknown"),
    refundedAmount: async (jobId) => [...ledger.values()].filter((r) => r.jobId === jobId).reduce((s, r) => s + r.amount, 0),
    spendAmount: async (jobId) => jobs[jobId]?.spend ?? 0,
    refund: async (p) => {
      refundCalls.n += 1;
      await Promise.resolve(); // let overlapping runs interleave
      if (!ledger.has(p.idempotencyKey)) ledger.set(p.idempotencyKey, { jobId: p.jobId, amount: p.amount });
    },
    settle: async (item, to, key) => {
      await Promise.resolve();
      const row = items.find((i) => i.id === item.id && i.profileId === item.profileId)!;
      if (row.state !== "ambiguous") return false;
      row.state = to;
      row.refundKey = key;
      return true;
    },
  };
  const deps = (w: { after: string; before: string }) => {
    const matching = (cursor: SettledCursor) =>
      items
        .filter((i) => i.state === "ambiguous" && Date.parse(i.updatedAt) > Date.parse(w.after) && Date.parse(i.updatedAt) < Date.parse(w.before))
        .map((i) => ({ ...i }))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : a.id < b.id ? -1 : 1))
        .filter((c) => !cursor || c.updatedAt > cursor.updatedAt || (c.updatedAt === cursor.updatedAt && c.id > cursor.id));
    return {
      fetchPage: async (cursor: SettledCursor, limit: number) => matching(cursor).slice(0, limit),
      countFrom: async (cursor: SettledCursor) => matching(cursor).length,
    };
  };
  /** One reconcile item scan at `now`, composed like runGenerationReconcile. */
  const run = (now: number, budgetMs?: number) => {
    const ws = settledWindows(now);
    return scanSettledJobs(
      {
        ...deps({ after: ws.expired.after, before: ws.active.before }),
        process: (item) => settleBatchItem(ops, item, { expired: Date.parse(item.updatedAt) <= Date.parse(ws.active.after), confirmTimeoutMs: 20 }),
      },
      budgetMs === undefined ? {} : { budgetMs },
    );
  };
  return { items, ledger, refundCalls, falCalls, run, ops };
}

const item = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  profileId: "p-1",
  jobId: "job-1",
  batchIndex: Number(id.replace(/\D/g, "")) || 0,
  provider: "fal",
  predictionId: `req-${id}@${ENDPOINT}`,
  credits: 5,
  updatedAt: new Date(T0 - 2 * HOUR).toISOString(),
  state: "ambiguous",
  refundKey: null,
  ...over,
});

async function main() {
  // 4. Fal confirms failure: exactly one refund of `credits` under :item:{i}; re-runs add nothing.
  {
    const w = world([item("i1", { fate: "failed" }), item("i2", { fate: "failed_4xx" })], { "job-1": { status: "succeeded", spend: 20, refunded: 5 } });
    const r = await w.run(T0);
    assert(r.outcomes.refunded === 2, "both confirmed failures refunded");
    assert(w.ledger.get(batchItemRefundKey("job-1", 1))?.amount === 5 && w.ledger.get("refund:product_photo:job-1:item:2")?.amount === 5, "one refund of credits per image, per-image key");
    assert(w.items.every((i) => i.state === "refunded" && i.refundKey === batchItemRefundKey("job-1", i.batchIndex)), "rows refunded with their key");
    const size = w.ledger.size;
    await w.run(T0 + HOUR);
    await w.run(T0 + 24 * HOUR);
    assert(w.ledger.size === size, "second run adds no ledger row");
  }

  // 5. Overlapping runs: one ledger row per image, whichever run wins the CAS.
  {
    const items = Array.from({ length: 6 }, (_, i) => item(`o${i}`, { jobId: `job-o${i}`, fate: "failed" }));
    const jobs = Object.fromEntries(items.map((i) => [i.jobId, { status: "succeeded", spend: 10 }]));
    const w = world(items, jobs);
    await Promise.all([w.run(T0), w.run(T0), w.run(T0)]);
    assert(w.ledger.size === 6 && [...w.ledger.values()].every((r) => r.amount === 5), "overlapping runs: one ledger row per image");
    assert(w.items.every((i) => i.state === "refunded"), "all settled once");
  }

  // 6. Not a definitive failure (processing / succeeded / 404 / 5xx / timeout): no refund, stays ambiguous.
  {
    const fates: Fate[] = ["processing", "succeeded", "expired_404", "server_5xx", "timeout"];
    const w = world(fates.map((f, i) => item(`a${i}`, { fate: f })), { "job-1": { status: "succeeded", spend: 30 } });
    const r = await w.run(T0);
    assert(r.outcomes.left === 5 && r.errors.length === 0, `ambiguous answers leave the rows open (${JSON.stringify(r)})`);
    assert(w.ledger.size === 0 && w.refundCalls.n === 0 && w.items.every((i) => i.state === "ambiguous"), "no refund, still ambiguous");
  }

  // 7. Delivered rows are never scanned; zero-success / running jobs are skipped (I1, I5).
  {
    const w = world(
      [
        item("d1", { state: "delivered", fate: "failed" }),
        item("d2", { state: "failed_definitive", fate: "failed" }),
        item("z1", { jobId: "job-zero", fate: "failed" }),
        item("z2", { jobId: "job-running", fate: "failed" }),
      ],
      { "job-1": { status: "succeeded", spend: 20 }, "job-zero": { status: "failed", spend: 10 }, "job-running": { status: "running", spend: 10 } },
    );
    const r = await w.run(T0);
    assert(r.scanned === 2 && r.outcomes.skipped_job === 2, "only ambiguous rows scanned; non-succeeded jobs skipped");
    assert(w.ledger.size === 0 && w.falCalls.n === 0, "never refunded, Fal not even asked");
  }

  // 8. Ledger cap (I3): never refund more than the job spent.
  {
    const w = world([item("c1", { fate: "failed" })], { "job-1": { status: "succeeded", spend: 10, refunded: 10 } });
    const r = await w.run(T0);
    assert(r.outcomes.over_cap === 1 && w.ledger.size === 1 && w.items[0].state === "ambiguous", "cap blocks the over-refund");
    const old = new Date(T0 - SETTLED_LOOKBACK_MS - HOUR).toISOString();
    const x = world([item("c2", { fate: "failed", updatedAt: old })], { "job-1": { status: "succeeded", spend: 10, refunded: 10 } });
    await x.run(T0);
    assert(x.items[0].state === "unresolved" && x.ledger.size === 1, "capped row past the lookback goes to manual review, no refund");
  }

  // 9. Replicate row (never written by the route) is never refunded by this scan.
  {
    const w = world([item("rp1", { provider: "replicate", fate: "failed" })], { "job-1": { status: "succeeded", spend: 10 } });
    await w.run(T0);
    assert(w.ledger.size === 0 && w.items[0].state === "ambiguous", "Replicate row: no refund");
  }

  // 10. No prediction id: unresolved at once, nothing asked, nothing refunded.
  {
    const w = world([item("n1", { predictionId: null })], { "job-1": { status: "succeeded", spend: 10 } });
    const r = await w.run(T0);
    assert(r.outcomes.unresolved === 1 && w.items[0].state === "unresolved" && w.ledger.size === 0 && w.falCalls.n === 0, "no prediction id -> unresolved");
  }

  // 11. Past 72 h: one last check, then unresolved (a last-minute confirmed failure still refunds).
  {
    const old = new Date(T0 - SETTLED_LOOKBACK_MS - HOUR).toISOString();
    const w = world(
      [item("x1", { updatedAt: old, fate: "succeeded" }), item("x2", { updatedAt: old, fate: "failed" }), item("x3", { updatedAt: old, fate: "server_5xx" })],
      { "job-1": { status: "succeeded", spend: 20 } },
    );
    const r = await w.run(T0);
    assert(w.falCalls.n === 3, "each expired row gets one last check");
    assert(w.items[0].state === "unresolved" && w.items[2].state === "unresolved" && w.items[1].state === "refunded", "expired: unresolved unless confirmed failed");
    assert(r.outcomes.unresolved === 2 && w.ledger.size === 1, "only the confirmed one refunded");
    const calls = w.falCalls.n;
    await w.run(T0 + HOUR);
    assert(w.falCalls.n === calls, "unresolved rows are not checked again");
    // Too fresh (< 5 min): left for the next run.
    const fresh = world([item("f1", { updatedAt: new Date(T0 - 60_000).toISOString(), fate: "failed" })], { "job-1": { status: "succeeded", spend: 10 } });
    assert((await fresh.run(T0)).scanned === 0, "too-fresh row waits for the next run");
  }

  // 12. Own budget slice: a spent budget leaves the rest for the next run, still one refund each.
  {
    const items = Array.from({ length: 30 }, (_, i) => item(`b${i}`, { jobId: `job-b${i}`, fate: "failed", updatedAt: new Date(T0 - 2 * HOUR - i * 1000).toISOString() }));
    const w = world(items, Object.fromEntries(items.map((i) => [i.jobId, { status: "succeeded", spend: 10 }])));
    const r = await w.run(T0, 0);
    assert(r.scanned === 0 && r.left === 30 && w.ledger.size === 0, "zero budget: nothing processed, all reported left");
    await w.run(T0 + HOUR);
    assert(w.ledger.size === 30, "next run finishes them");
  }

  // 13. The adapter reports each run's own prediction id, so the route's per-index wrapper is exact.
  {
    let n = 0;
    const fake = fakeFal(new Map(), { n: 0 });
    fake.queue.submit = async () => ({ request_id: `run-${++n}` });
    fake.queue.status = async () => ({ status: "COMPLETED" });
    const p = createFalPhotoProvider(fake, 0);
    const ids: (string | undefined)[] = [];
    await Promise.all([0, 1, 2].map((i) => p.run({ model: ENDPOINT, input: { prompt: "x" }, hooks: { onPrediction: (t) => { ids[i] = t.id; } } })));
    assert(new Set(ids).size === 3 && ids.every((id) => id?.startsWith("run-")), "one distinct id per image index");
  }

  // 14. Data module with the table MISSING (Supabase answers via stubbed fetch): no throw, "missing",
  // remembered for a minute, then switches on by itself once the table exists.
  {
    process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:1";
    process.env.SUPABASE_SERVICE_ROLE_KEY ||= "self-check";
    const realFetch = globalThis.fetch;
    const realNow = Date.now;
    const realWarn = console.warn;
    const warnings: string[] = [];
    console.warn = (...a: unknown[]) => { warnings.push(a.join(" ")); };
    let tableExists = false;
    let requests = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests += 1;
      assert(String(input).includes("/generation_batch_items"), "only the batch items table is queried");
      if (!tableExists) {
        // PostgREST: a HEAD has no body (supabase-js then reports success); GET/POST carry the error JSON.
        if (init?.method === "HEAD") return new Response(null, { status: 404 });
        return new Response(JSON.stringify({ code: "PGRST205", message: "Could not find the table 'public.generation_batch_items' in the schema cache" }), { status: 404, headers: { "content-type": "application/json" } });
      }
      if (init?.method === "POST") return new Response(null, { status: 201 });
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    try {
      const db = await import("../generation-batch-items-db");
      const rows = rowsFor(fal, [ok(), no(networkLoss())])!;
      assert((await db.batchItemsTableReady()) === false, "missing table: reconcile probe says not ready (fresh, no cache), no throw");
      assert((await db.insertBatchItems(rows)) === "missing" && (await db.batchItemsTableReady()) === false, "cached: insert and probe report missing");
      assert(requests === 1 && warnings.length === 1, "one request and one log line while cached");
      tableExists = true; // Ryan applies 119
      const t = realNow();
      Date.now = () => t + 61_000;
      assert((await db.insertBatchItems(rows)) === "written", "switches on within a minute, no redeploy");
      assert((await db.batchItemsTableReady()) === true, "reconcile scan switches on too");
    } finally {
      globalThis.fetch = realFetch;
      Date.now = realNow;
      console.warn = realWarn;
    }
  }

  // 15. Route, page and migration wiring.
  {
    const route = readFileSync("app/api/generate-photo/route.ts", "utf8");
    assert(route.includes("batchPredictionIds[index] = t.id;") && route.includes("baseHooks?.onPrediction?.(t);"), "route: prediction id captured per image and still recorded");
    assert(route.includes("batchOutputUrls[index] = generatedImageUrl;"), "route: output url captured before download/save");
    assert(route.includes("saveGeneratedProductPhoto({ userId, imageBuffer, ...deliveryParams(index) })"), "route: stored delivery params are exactly the save params");
    assert(route.includes('const unconfirmedRecheck = batchItemRows ? (await insertBatchItems(batchItemRows)) === "written" : false;'), "route: recheck only when rows were written");
    assert(route.includes("...(unconfirmedRecheck ? { unconfirmedRecheck: true } : {}),"), "route: additive response field, absent otherwise");
    const refundAt = route.indexOf("if (failureCount > 0) await refundFailedImages();");
    const insertAt = route.indexOf("await insertBatchItems(");
    const finishAt = route.indexOf('safe("finishJob"');
    assert(refundAt > 0 && refundAt < insertAt && insertAt < finishAt, "route: rows written after the partial refund, before finishJob");
    const page = readFileSync("app/(app)/tools/photo-v2/page.tsx", "utf8");
    assert(page.includes("recheck: data.unconfirmedRecheck === true,"), "page: passes the recheck flag");
    const sql = readFileSync("supabase/migrations/119_generation_batch_items.sql", "utf8");
    assert(sql.includes("create table if not exists generation_batch_items") && sql.includes("unique (job_id, batch_index)") && sql.includes("enable row level security") && !/create policy/i.test(sql), "migration: idempotent, unique per image, RLS without policies");
  }

  console.log("generation-batch-items self-check passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
