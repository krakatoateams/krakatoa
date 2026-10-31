/**
 * S2 phases 2-3 self-check: per-image settlement of partly delivered multi-image Fal requests
 * (migration 119), including late delivery. REAL: planBatchItemRows, settleBatchItem,
 * deliverBatchItemLate, scanSettledJobs/settledWindows, the Fal adapter's getPredictionStatus and
 * getPredictionOutput (fake Fal client), the canonical refund policy, batchFailureMessage and the
 * generation_batch_items data module (Supabase answered by a stubbed fetch). Fake: the job table, the
 * item table, a ledger that dedupes idempotency keys like credit_transactions, and storage + library +
 * assets that behave like saveGeneratedProductPhoto (upsert: false, unique storage_path).
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
  BATCH_ITEM_LEASE_MS,
  LATE_DELIVERY_STORED_CODE,
  batchItemRefundKey,
  planBatchItemRows,
  settleBatchItem,
  type BatchItemCandidate,
  type BatchItemOps,
  type BatchItemState,
} from "../generation-batch-items-pure";
import { photosGeneratedPath } from "../product-photo";
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
      "2 of 4 images didn't arrive. 1 was refunded. 1 couldn't be confirmed yet, so we're re-checking it with the AI provider: if it finished, it'll appear in your library; if it failed, the credits come back automatically.",
    "recheck singular",
  );
  assert(
    batchFailureMessage({ failed: 2, requested: 3, delivered: 1, unconfirmed: 2, recheck: true }) ===
      "2 of 3 images didn't arrive. 2 couldn't be confirmed yet, so we're re-checking them with the AI provider: if they finished, they'll appear in your library; if they failed, the credits come back automatically.",
    "recheck plural",
  );
  assert(
    batchFailureMessage({ failed: 1, requested: 4, delivered: 3, unconfirmed: 0, recheck: true }) ===
      "1 of 4 images couldn't be generated — you were only charged for the 3 that worked.",
    "nothing unconfirmed: today's text",
  );
}

// Fake Fal: per request id fate, answered through the REAL adapter's getPredictionStatus.
type Fate =
  | "failed"
  | "failed_4xx"
  | "processing"
  | "succeeded"
  | "expired_404"
  | "server_5xx"
  | "timeout"
  // Phase 3: COMPLETED, but the output read for delivery fails or is not trusted.
  | "untrusted_output"
  | "gone_after_status"
  | "download_fails"
  | "save_fails"
  // Overlapping runs get contradictory answers: odd status reads say failed, even ones say finished.
  | "contradictory";
const OUT_URL = "https://v3.fal.media/files/out.png";
const BROKEN_URL = "https://v3.fal.media/files/broken.png";
function fakeFal(fates: { get(requestId: string): Fate | undefined }, calls: { n: number }): FalQueueLike {
  const fate = (id: string) => fates.get(id) ?? "processing";
  const results = new Map<string, number>();
  const statuses = new Map<string, number>();
  return {
    queue: {
      submit: async () => ({ request_id: "unused" }),
      status: async (_e, o) => {
        calls.n += 1;
        const f = fate(o.requestId);
        if (f === "timeout") return new Promise(() => {});
        if (f === "server_5xx") throw new ApiError({ message: "unavailable", status: 503, body: {} });
        if (f === "processing") return { status: "IN_PROGRESS" };
        const n = (statuses.get(o.requestId) ?? 0) + 1;
        statuses.set(o.requestId, n);
        if (f === "failed" || (f === "contradictory" && n % 2 === 1)) return { status: "COMPLETED", error: "runner failed" };
        return { status: "COMPLETED" };
      },
      result: async (_e, o) => {
        const f = fate(o.requestId);
        const n = (results.get(o.requestId) ?? 0) + 1;
        results.set(o.requestId, n);
        if (f === "expired_404" || (f === "gone_after_status" && n > 1)) throw new ApiError({ message: "gone", status: 404, body: {} });
        if (f === "failed_4xx") throw new ApiError({ message: "bad", status: 422, body: {} });
        if (f === "untrusted_output") return { data: { images: [{ url: "https://evil.example.com/out.png" }] } };
        if (f === "download_fails") return { data: { images: [{ url: BROKEN_URL }] } };
        return { data: { images: [{ url: OUT_URL }] } };
      },
      cancel: async () => "unknown",
    },
    storage: { upload: async () => "https://v3.fal.media/files/up.png" },
  };
}

type Item = Omit<BatchItemCandidate, "state"> & { state: BatchItemState; fate?: Fate; lease?: string; errorCode?: string };
const isOpen = (s: BatchItemState): s is "ambiguous" | "delivering" => s === "ambiguous" || s === "delivering";

function world(items: Item[], jobs: Record<string, { status: string; spend: number; refunded?: number }>) {
  // Read live, so a test can change what Fal answers between runs.
  const fates = { get: (requestId: string) => items.find((i) => `req-${i.id}` === requestId)?.fate };
  const falCalls = { n: 0 };
  const provider = createFalPhotoProvider(fakeFal(fates, falCalls), 0);
  const ledger = new Map<string, { jobId: string; amount: number }>(); // idempotency_key unique
  const refundCalls = { n: 0 };
  const refundFaults: ("error" | "commit_then_error" | "hang")[] = [];
  const clock = { now: T0, tick: 0 };
  const storage = new Map<string, ArrayBuffer>(); // upsert: false
  const creations = new Set<string>(); // user_creations, unique storage_path
  const assets = new Map<string, string>(); // `${profileId}/${assetId}` -> ready storage path
  const downloads = { n: 0 };
  const save: { gate?: Promise<void>; crashAfterUpload?: boolean; markReadyFails?: boolean } = {};
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
      await Promise.resolve();
      const mode = refundFaults.shift();
      if (mode === "hang") return new Promise<never>(() => {}); // run killed before the ledger call returned
      if (mode === "error") throw new Error("credit RPC unavailable");
      if (!ledger.has(p.idempotencyKey)) ledger.set(p.idempotencyKey, { jobId: p.jobId, amount: p.amount });
      if (mode === "commit_then_error") throw new Error("credit RPC response lost");
    },
    settle: async (item, to, key) => {
      await Promise.resolve();
      const row = items.find((i) => i.id === item.id && i.profileId === item.profileId)!;
      if (row.state !== "ambiguous") return false;
      row.state = to;
      if (key) row.refundKey = key; // like settleAmbiguousBatchItem: a null key leaves the column as is
      return true;
    },
    markRefund: async (item, key) => {
      await Promise.resolve();
      const row = items.find((i) => i.id === item.id && i.profileId === item.profileId)!;
      if (row.state !== "ambiguous") return false;
      row.refundKey = key;
      return true;
    },
    late: {
      claim: async (item, staleBefore) => {
        await Promise.resolve();
        const row = items.find((i) => i.id === item.id && i.profileId === item.profileId)!;
        if (row.state !== item.state || row.refundKey) return null;
        if (row.state === "delivering" && !(row.lease! < staleBefore)) return null;
        row.state = "delivering";
        row.lease = new Date(clock.now + ++clock.tick).toISOString(); // like the updated_at trigger
        return row.lease;
      },
      outputUrl: async (providerId, id) => {
        if (providerId !== "fal") throw new Error("no late delivery");
        return provider.getPredictionOutput!(id);
      },
      download: async (url) => {
        await Promise.resolve();
        if (url === BROKEN_URL) throw new Error("Download failed (403).");
        downloads.n += 1;
        return new TextEncoder().encode(url).buffer as ArrayBuffer;
      },
      userIdForProfile: async (profileId) => (profileId === "p-1" ? "u-1" : ""),
      isStored: async (path) => storage.has(path),
      save: async (p) => {
        // saveGeneratedProductPhoto: upload with upsert:false, then the library row (unique storage_path).
        const gate = save.gate; // one-shot: holds only the first save that sees it
        save.gate = undefined;
        if (gate) await gate;
        const path = photosGeneratedPath(p.userId, p.photoMode, p.filename);
        if (items.some((i) => i.fate === "save_fails" && i.delivery?.filename === p.filename)) throw new Error("Failed to save generated image: R2 upload failed (500).");
        if (storage.has(path)) throw new Error("Failed to save generated image: The resource already exists");
        storage.set(path, p.imageBuffer);
        if (save.crashAfterUpload) return new Promise<never>(() => {}); // run killed mid-save
        if (creations.has(path)) throw new Error("duplicate key value violates unique constraint");
        creations.add(path);
        return { storagePath: path };
      },
      recordLibrary: async (p) => {
        creations.add(p.storagePath); // unique storage_path: a duplicate is a no-op
      },
      markReady: async (profileId, assetId, storagePath) => {
        if (save.markReadyFails) throw new Error("Failed to mark asset ready.");
        assets.set(`${profileId}/${assetId}`, storagePath);
      },
      finish: async (item, lease, to) => {
        await Promise.resolve();
        const row = items.find((i) => i.id === item.id && i.profileId === item.profileId)!;
        if (row.state !== "delivering" || (to === "ambiguous" && row.lease !== lease)) return false;
        row.state = to;
        if (to === "unresolved") row.errorCode = LATE_DELIVERY_STORED_CODE;
        row.lease = new Date(clock.now + ++clock.tick).toISOString();
        return true;
      },
      now: () => clock.now,
    },
  };
  const deps = (w: { after: string; before: string }) => {
    const matching = (cursor: SettledCursor) =>
      items
        .filter((i) => isOpen(i.state) && Date.parse(i.updatedAt) > Date.parse(w.after) && Date.parse(i.updatedAt) < Date.parse(w.before))
        .map((i) => ({ ...i, state: i.state as "ambiguous" | "delivering" }))
        .sort((a, b) => (a.updatedAt < b.updatedAt ? -1 : a.updatedAt > b.updatedAt ? 1 : a.id < b.id ? -1 : 1))
        .filter((c) => !cursor || c.updatedAt > cursor.updatedAt || (c.updatedAt === cursor.updatedAt && c.id > cursor.id));
    return {
      fetchPage: async (cursor: SettledCursor, limit: number) => matching(cursor).slice(0, limit),
      countFrom: async (cursor: SettledCursor) => matching(cursor).length,
    };
  };
  /** One reconcile item scan at `now`, composed like runGenerationReconcile. */
  const run = (now: number, budgetMs?: number) => {
    clock.now = now;
    const ws = settledWindows(now);
    return scanSettledJobs(
      {
        ...deps({ after: ws.expired.after, before: ws.active.before }),
        process: (item) => settleBatchItem(ops, item, { expired: Date.parse(item.updatedAt) <= Date.parse(ws.active.after), confirmTimeoutMs: 20 }),
      },
      budgetMs === undefined ? {} : { budgetMs },
    );
  };
  return { items, ledger, refundCalls, refundFaults, falCalls, run, ops, storage, creations, assets, downloads, save, clock };
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
  assetId: `asset-${id}`,
  delivery: { photoMode: "social", filename: `${1_800_000_000_000 + (Number(id.replace(/\D/g, "")) || 0)}__auto__auto.jpg`, poseId: "auto", styleId: "auto", jobId: "job-1" },
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

  // 6. Not a definitive failure (processing / 404 / 5xx / timeout): no refund, stays ambiguous, nothing saved.
  // (succeeded is delivered late: section 16.)
  {
    const fates: Fate[] = ["processing", "expired_404", "server_5xx", "timeout"];
    const w = world(fates.map((f, i) => item(`a${i}`, { fate: f })), { "job-1": { status: "succeeded", spend: 30 } });
    const r = await w.run(T0);
    assert(r.outcomes.left === 4 && r.errors.length === 0, `ambiguous answers leave the rows open (${JSON.stringify(r)})`);
    assert(w.ledger.size === 0 && w.refundCalls.n === 0 && w.items.every((i) => i.state === "ambiguous"), "no refund, still ambiguous");
    assert(w.storage.size === 0 && w.downloads.n === 0, "nothing downloaded or saved");
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
      [item("x1", { updatedAt: old, fate: "processing" }), item("x2", { updatedAt: old, fate: "failed" }), item("x3", { updatedAt: old, fate: "server_5xx" })],
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

  // 16. Late delivery: Fal COMPLETED with a trusted output -> saved exactly once under {userId}/ with the
  // stored params, asset ready, row delivered_late, no refund. Re-runs change nothing (I1).
  {
    const w = world([item("l1", { fate: "succeeded" })], { "job-1": { status: "succeeded", spend: 10 } });
    const r = await w.run(T0);
    const path = photosGeneratedPath("u-1", "social", w.items[0].delivery!.filename as string);
    assert(r.outcomes.delivered_late === 1 && w.items[0].state === "delivered_late", `delivered late (${JSON.stringify(r)})`);
    assert(path.startsWith("u-1/") && w.storage.size === 1 && w.storage.has(path) && w.creations.has(path), "saved once under the owner's prefix with the stored filename");
    assert(w.assets.get("p-1/asset-l1") === path, "asset marked ready (owner-scoped) with the saved path");
    assert(w.ledger.size === 0 && w.refundCalls.n === 0, "no refund for a delivered image");
    w.items[0].fate = "failed"; // even if Fal later said otherwise
    await w.run(T0 + HOUR);
    assert(w.storage.size === 1 && w.downloads.n === 1 && w.ledger.size === 0 && w.items[0].state === "delivered_late", "delivered_late is terminal: never re-saved or refunded");
  }

  // 17. Untrusted URL, 404 on the output read, download failure, save failure, unusable params or owner:
  // back to ambiguous, nothing saved, no refund; past 72 h the expiry rule still moves them to unresolved.
  {
    const failing = (prefix: string, over: Partial<Item> = {}) => [
      item(`${prefix}1`, { fate: "untrusted_output", ...over }),
      item(`${prefix}2`, { fate: "gone_after_status", ...over }),
      item(`${prefix}3`, { fate: "download_fails", ...over }),
      item(`${prefix}4`, { fate: "save_fails", ...over }),
      item(`${prefix}5`, { fate: "succeeded", delivery: { photoMode: "social", filename: "../../other-user/x.jpg" }, ...over }),
      item(`${prefix}6`, { fate: "succeeded", profileId: "p-unknown", ...over }),
    ];
    const w = world(failing("e"), { "job-1": { status: "succeeded", spend: 40 } });
    const r = await w.run(T0);
    assert(r.outcomes.left === 6 && r.errors.length === 0, `failed deliveries are left (${JSON.stringify(r)})`);
    assert(w.items.every((i) => i.state === "ambiguous"), "every failed delivery is back to ambiguous");
    assert(w.storage.size === 0 && w.creations.size === 0 && w.assets.size === 0, "nothing saved, no asset touched");
    assert(w.ledger.size === 0 && w.refundCalls.n === 0, "no refund");
    const old = new Date(T0 - SETTLED_LOOKBACK_MS - HOUR).toISOString();
    const x = world(failing("x", { updatedAt: old }), { "job-1": { status: "succeeded", spend: 40 } });
    const rx = await x.run(T0);
    assert(rx.outcomes.unresolved === 6 && x.items.every((i) => i.state === "unresolved"), "expired failed deliveries -> unresolved");
    assert(x.storage.size === 0 && x.ledger.size === 0, "still nothing saved or refunded");
  }

  // 18. Overlapping runs: each finished image is saved exactly once, whichever run wins the claim.
  {
    const items = Array.from({ length: 4 }, (_, i) => item(`v${i}`, { fate: "succeeded" }));
    const w = world(items, { "job-1": { status: "succeeded", spend: 20 } });
    await Promise.all([w.run(T0), w.run(T0), w.run(T0)]);
    assert(w.storage.size === 4 && w.creations.size === 4 && w.downloads.n === 4, `one save per image (${w.storage.size}, ${w.downloads.n})`);
    assert(w.items.every((i) => i.state === "delivered_late") && w.ledger.size === 0, "all delivered late, no refund");
  }

  // 19. Lease expiry mid-save: a fresh lease is never taken over; a stale one is, and the slow first run then
  // hits the storage conflict (= delivered). Still exactly one saved image.
  {
    const w = world([item("s1", { fate: "succeeded" })], { "job-1": { status: "succeeded", spend: 10 } });
    let release!: () => void;
    w.save.gate = new Promise<void>((r) => { release = r; });
    const first = w.run(T0);
    while ((w.items[0].state as BatchItemState) !== "delivering" || w.downloads.n === 0) await new Promise((r) => setTimeout(r, 1));
    const fresh = await w.run(T0 + BATCH_ITEM_LEASE_MS / 2);
    assert(fresh.outcomes.leased === 1 && w.storage.size === 0, "a fresh lease is not reclaimed");
    const second = await w.run(T0 + BATCH_ITEM_LEASE_MS + 60_000);
    assert(second.outcomes.delivered_late === 1 && w.storage.size === 1, "a stale lease is reclaimed and delivered");
    release();
    const r1 = await first;
    assert(r1.outcomes.raced === 1 && r1.errors.length === 0, `slow first run: conflict counts as delivered, CAS lost (${JSON.stringify(r1)})`);
    assert(w.storage.size === 1 && w.creations.size === 1 && w.items[0].state === "delivered_late" && w.ledger.size === 0, "exactly one saved image, no refund");
  }

  // 20. Crash mid-save (uploaded, then the run died): the row stays delivering; after the lease the next run
  // reclaims it, storage says "already exists" -> delivered, asset ready. Still one image.
  {
    const w = world([item("k1", { fate: "succeeded" })], { "job-1": { status: "succeeded", spend: 10 } });
    w.save.crashAfterUpload = true;
    void w.run(T0); // never settles: the run was killed
    while (w.storage.size === 0) await new Promise((r) => setTimeout(r, 1));
    w.save.crashAfterUpload = false;
    assert(w.items[0].state === "delivering", "crashed run leaves the lease behind");
    const r = await w.run(T0 + BATCH_ITEM_LEASE_MS + 60_000);
    const path = photosGeneratedPath("u-1", "social", w.items[0].delivery!.filename as string);
    assert(r.outcomes.delivered_late === 1 && w.items[0].state === "delivered_late", "reclaimed after the lease");
    assert(w.storage.size === 1 && w.assets.get("p-1/asset-k1") === path && w.ledger.size === 0, "one image, asset ready, no refund");
    assert(w.creations.size === 1 && w.creations.has(path), "the library row the crashed run never wrote is added");
  }

  // 20b. Stored, then the asset update fails: the row stays delivering (never back to ambiguous, so never
  // refunded); the next run after the lease finishes it. Still one image. (Past 72 h: section 26.)
  {
    const w = world([item("m1", { fate: "succeeded" })], { "job-1": { status: "succeeded", spend: 10 } });
    w.save.markReadyFails = true;
    const r = await w.run(T0);
    assert(r.errors.length === 1 && w.items[0].state === "delivering" && w.storage.size === 1, `stored image keeps the row delivering (${JSON.stringify(r)})`);
    w.items[0].fate = "failed";
    w.save.markReadyFails = false;
    const again = await w.run(T0 + 60_000);
    assert(again.outcomes.leased === 1 && w.ledger.size === 0, "held lease: not reclaimed, not refunded even though Fal now says failed");
    const r2 = await w.run(T0 + BATCH_ITEM_LEASE_MS + 60_000);
    assert(r2.outcomes.delivered_late === 1 && w.storage.size === 1 && w.creations.size === 1 && w.ledger.size === 0, "next run after the lease delivers it once, no refund");
  }

  // 21. Replicate rows (never written by the route) and non-succeeded jobs: no change from phase 2.
  {
    const w = world(
      [item("rq1", { provider: "replicate", fate: "succeeded" }), item("rq2", { jobId: "job-running", fate: "succeeded" }), item("rq3", { jobId: "job-running", state: "delivering", lease: new Date(0).toISOString(), fate: "succeeded" })],
      { "job-1": { status: "succeeded", spend: 10 }, "job-running": { status: "running", spend: 10 } },
    );
    const r = await w.run(T0);
    assert(r.outcomes.left === 1 && r.outcomes.skipped_job === 2, `Replicate left, other jobs skipped (${JSON.stringify(r)})`);
    assert(w.storage.size === 0 && w.items[0].state === "ambiguous" && w.ledger.size === 0, "Replicate: nothing saved or refunded");
    assert(!readFileSync("lib/ai-providers/replicate-photo.ts", "utf8").includes("getPredictionOutput"), "Replicate does not implement late delivery");
  }

  // 23. Overlapping runs with contradictory Fal answers for the same image (one failed, one finished):
  // the row is taken before any money or media moves, so at most ONE of refund / delivery happens (I1).
  {
    for (let stagger = 0; stagger < 6; stagger += 1) {
      const w = world([item("y1", { fate: "contradictory" })], { "job-1": { status: "succeeded", spend: 10 } });
      const later = async () => {
        for (let i = 0; i < stagger; i += 1) await Promise.resolve();
        return w.run(T0);
      };
      await Promise.all([w.run(T0), later()]);
      const refunded = w.ledger.has(batchItemRefundKey("job-1", 1));
      const delivered = w.storage.size > 0;
      assert(!(refunded && delivered), `stagger ${stagger}: image both refunded and delivered`);
      assert(refunded || delivered, `stagger ${stagger}: one of the two settles it`);
      assert(refunded ? w.items[0].state === "refunded" && w.ledger.size === 1 : w.items[0].state === "delivered_late" && w.storage.size === 1, `stagger ${stagger}: row matches what happened (${w.items[0].state})`);
    }
  }

  // 24. The refund call errors (before or after the ledger committed) or the run dies after the mark: the
  // row stays ambiguous carrying its key. The next run does not ask Fal again and never delivers it, even
  // if Fal would now say finished: it retries the refund with the same key. Exactly one ledger row (I1, I2).
  {
    for (const fault of ["error", "commit_then_error", "hang"] as const) {
      const w = world([item("z9", { fate: "failed" })], { "job-1": { status: "succeeded", spend: 10 } });
      w.refundFaults.push(fault);
      const first = w.run(T0);
      if (fault === "hang") {
        while (w.refundCalls.n === 0) await new Promise((r) => setTimeout(r, 1));
      } else {
        assert((await first).errors.length === 1, `${fault}: error recorded`);
      }
      const key = batchItemRefundKey("job-1", 9);
      assert(w.items[0].state === "ambiguous" && w.items[0].refundKey === key, `${fault}: row stays ambiguous with its key`);
      assert(w.ledger.size === (fault === "commit_then_error" ? 1 : 0), `${fault}: ledger as the fault left it`);
      w.items[0].fate = "succeeded"; // Fal would now say finished
      const calls = w.falCalls.n;
      const r = await w.run(T0 + HOUR);
      assert(r.outcomes.refunded === 1 && w.items[0].state === "refunded", `${fault}: marked row retries the refund (${JSON.stringify(r)})`);
      assert(w.falCalls.n === calls && w.storage.size === 0 && w.downloads.n === 0, `${fault}: Fal not asked again, never delivered`);
      assert(w.ledger.size === 1 && w.ledger.get(key)?.amount === 5, `${fault}: exactly one refund`);
    }
  }

  // 25. A marked row whose refund keeps failing still reaches unresolved past 72 h (visible to manual
  // review, key kept); a last retry that works refunds it instead.
  {
    const old = new Date(T0 - SETTLED_LOOKBACK_MS - HOUR).toISOString();
    const key = batchItemRefundKey("job-1", 8);
    const w = world([item("u8", { fate: "succeeded", updatedAt: old, refundKey: key })], { "job-1": { status: "succeeded", spend: 10 } });
    w.refundFaults.push("error");
    const r = await w.run(T0);
    assert(w.items[0].state === "unresolved" && w.items[0].refundKey === key, `failing marked row -> unresolved (${JSON.stringify(r)})`);
    assert(r.errors.length === 1 && r.errors[0].includes("credit RPC unavailable"), "the refund error is still reported");
    assert(w.ledger.size === 0 && w.storage.size === 0, "no refund, no delivery");
    const ok = world([item("u7", { fate: "succeeded", updatedAt: old, refundKey: batchItemRefundKey("job-1", 7) })], { "job-1": { status: "succeeded", spend: 10 } });
    const r2 = await ok.run(T0);
    assert(r2.outcomes.refunded === 1 && ok.ledger.size === 1 && ok.storage.size === 0, "last retry works: refunded once");
  }

  // 26. Stored, but the asset update keeps failing (20b: the row stays delivering and is reclaimed after
  // each lease): past 72 h it ends unresolved with a code saying the image is saved. Never refunded.
  {
    const old = new Date(T0 - SETTLED_LOOKBACK_MS - HOUR).toISOString();
    const w = world([item("g1", { fate: "succeeded", updatedAt: old })], { "job-1": { status: "succeeded", spend: 10 } });
    w.save.markReadyFails = true;
    const r = await w.run(T0);
    assert(w.items[0].state === "unresolved" && w.items[0].errorCode === LATE_DELIVERY_STORED_CODE, `expired stored row -> unresolved (${JSON.stringify(r)})`);
    assert(r.errors.length === 1 && w.storage.size === 1 && w.ledger.size === 0, "error reported, one image, no refund");
  }

  // 26b. A reclaimed delivering row whose image is already stored is finalized without asking Fal again,
  // even when Fal's output is gone by now: a stored image never goes back to ambiguous.
  {
    const stale = new Date(T0 - BATCH_ITEM_LEASE_MS - 60_000).toISOString();
    const w = world([item("h1", { fate: "expired_404", state: "delivering", lease: stale })], { "job-1": { status: "succeeded", spend: 10 } });
    const path = photosGeneratedPath("u-1", "social", w.items[0].delivery!.filename as string);
    w.storage.set(path, new ArrayBuffer(1)); // an earlier run saved it, then died before finalizing
    const r = await w.run(T0);
    assert(r.outcomes.delivered_late === 1 && w.items[0].state === "delivered_late", `reclaimed stored row finalized (${JSON.stringify(r)})`);
    assert(w.downloads.n === 0 && w.storage.size === 1 && w.creations.has(path) && w.assets.get("p-1/asset-h1") === path, "no re-fetch, library row + asset ready");
    assert(w.ledger.size === 0, "no refund");
    // Same, but finalizing keeps failing past 72 h: unresolved with the stored code, never ambiguous.
    const old = new Date(T0 - SETTLED_LOOKBACK_MS - HOUR).toISOString();
    const x = world([item("h2", { fate: "expired_404", state: "delivering", lease: stale, updatedAt: old })], { "job-1": { status: "succeeded", spend: 10 } });
    x.storage.set(photosGeneratedPath("u-1", "social", x.items[0].delivery!.filename as string), new ArrayBuffer(1));
    x.save.markReadyFails = true;
    const rx = await x.run(T0);
    assert(x.items[0].state === "unresolved" && x.items[0].errorCode === LATE_DELIVERY_STORED_CODE && rx.errors.length === 1, `reclaimed stored row past 72 h -> unresolved with code (${JSON.stringify(rx)})`);
    assert(x.ledger.size === 0 && x.downloads.n === 0, "no refund, no re-fetch");
  }

  // 22. Reconcile wiring: the real save helper, owner-scoped asset update, provider seam, counter.
  {
    const rec = readFileSync("lib/generation-reconcile.ts", "utf8");
    assert(rec.includes("saveGeneratedProductPhoto({ ...rest, poseId: poseId as ModelPoseId, styleId: styleId as PhotoStyleId })"), "reconcile: saves with saveGeneratedProductPhoto and the stored params");
    assert(rec.includes("markAssetReady(profileId, assetId, {") && rec.includes("claim: claimBatchItemDelivery") && rec.includes("finish: finishBatchItemDelivery"), "reconcile: owner-scoped asset + CAS ops");
    assert(rec.includes("markRefund: markBatchItemRefund"), "reconcile: refund key marked before the ledger call");
    assert(rec.includes("await insertProductPhotoGeneration({") && rec.includes("/duplicate key|unique constraint/i"), "reconcile: conflict path writes the library row, duplicate is a no-op");
    assert(rec.includes("provider.getPredictionOutput(predictionId)") && rec.includes("result.itemsDeliveredLate = items.outcomes.delivered_late ?? 0;"), "reconcile: provider seam + itemsDeliveredLate");
    const db = readFileSync("lib/generation-batch-items-db.ts", "utf8");
    assert(db.includes('.is("refund_idempotency_key", null); // a refund may have been paid'), "db: late delivery never claims a row with a refund key");
    assert(db.includes("delivery, refund_idempotency_key") && db.includes("refundKey: r.refund_idempotency_key"), "db: the scan loads the refund key");
    assert(db.includes("error_code: LATE_DELIVERY_STORED_CODE"), "db: stored-but-unfinished rows carry a code for manual review");
    assert(rec.includes("await mediaExists(storagePath)"), "reconcile: reclaimed rows check Storage before re-fetching");
    assert(db.includes('.in("state", ["ambiguous", "delivering"])') && db.includes('q = q.lt("updated_at", staleBefore)') && db.includes('q = q.eq("updated_at", lease)'), "db: open scan, lease reclaim, own-lease release");
  }

  console.log("generation-batch-items self-check passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
