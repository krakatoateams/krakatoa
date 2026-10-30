/**
 * Best-effort Fal photo cancel (#421), offline. Real: the Fal adapter, the cancel/commit compare-and-set
 * row functions, finishMeteredAttemptWithOps + resolveMeteredSettlement, the batch failure plan and the
 * client cancel classifier. Faked: the Fal queue (scripted statuses and cancel answers) and the ledger.
 * `generate()` mirrors the generate-photo route glue (hooks.commit / abortCheck / onCancelAttempt / settle).
 */
import { readFileSync } from "node:fs";
import { ApiError } from "@fal-ai/client";
import { GenerationCancelledError, isGenerationCancelled, isProviderDefinitiveFailure } from "./errors";
import { createFalPhotoProvider, type FalQueueLike } from "./fal-photo";
import { classifyFalCancel, type FalCancelResult } from "./fal-cancel-pure";
import { finishMeteredAttemptWithOps, type MeteredLifecycleOps } from "../metered-generation/lifecycle-core";
import { resolveMeteredSettlement } from "../metered-generation/settlement-pure";
import {
  casLockUnlessCancelRequested,
  casRequestCancel,
  forceCommitRow,
  isRefundableUserCancellationPure,
  type CancelRow,
} from "../generation-commit-pure";
import { planBatchFailures } from "../photo-batch-failure-pure";
import {
  CANCEL_FAILED_MESSAGE,
  CANCEL_NOT_ALLOWED_MESSAGE,
  cancelUiState,
  postGenerationCancel,
} from "../generation-cancel-client-pure";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`falCancelSelfCheck: ${msg}`);
}

const HOST = "https://v3.fal.media/files/out.png";
const COST = 5;
const INPUT = { prompt: "p", resolution: "2K", aspect_ratio: "1:1", output_format: "png" };

type Phase = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
type Cancel = "honor" | "signalled" | "network" | "removed_but_completes";

/** Scriptable Fal: per-request phase list (one entry consumed per status() call, last repeats). */
function makeFal(scripts: Phase[][], cancel: Cancel, log: string[], tick: (n: number) => void = () => undefined) {
  let ticks = 0;
  const idx: number[] = scripts.map(() => 0);
  const removed = new Set<string>();
  let submitted = 0;
  const reqIdx = (id: string) => Number(id.slice(1));
  const fal: FalQueueLike = {
    queue: {
      submit: async () => ({ request_id: `r${submitted++}` }),
      status: async (_e, { requestId }) => {
        const i = reqIdx(requestId);
        tick(++ticks);
        if (removed.has(requestId)) return { status: "COMPLETED" }; // a cancelled request reports COMPLETED
        const s = scripts[i];
        return { status: s[Math.min(idx[i]++, s.length - 1)] };
      },
      result: async (_e, { requestId }) => {
        if (removed.has(requestId)) throw new ApiError({ message: "cancelled", status: 499, body: {} });
        return { data: { images: [{ url: HOST }] } };
      },
      cancel: async (_e, { requestId }): Promise<FalCancelResult> => {
        log.push(`fal-cancel:${requestId}`);
        const i = reqIdx(requestId);
        const cur = scripts[i][Math.max(0, Math.min(idx[i], scripts[i].length) - 1)];
        if (cancel === "network") throw new Error("fetch failed");
        if (cur === "COMPLETED") return "already_completed";
        if (cur === "IN_PROGRESS" || cancel === "signalled") return "signalled";
        if (cancel === "removed_but_completes") return "removed"; // answers OK but the run finishes anyway
        removed.add(requestId);
        return "removed";
      },
    },
    storage: { upload: async () => HOST },
  };
  return fal;
}

type Ledger = { events: string[]; balance: number; refundKeys: Set<string> };

function ops(ledger: Ledger, isLocked: () => boolean, spent: number): MeteredLifecycleOps {
  const noop = async () => undefined;
  return {
    isProviderCommitLocked: async () => isLocked(),
    resolveMeteredSettlement,
    persistMeteredSettlementLegacy: async (plan: { refundEligible: boolean }, ctx: Record<string, unknown>) => {
      if (!plan.refundEligible) return { refunded: false };
      const key = `refund:${String(ctx.refundJobType)}:${String(ctx.jobId)}`; // stable, like the route
      if (ledger.refundKeys.has(key)) return { refunded: false };
      ledger.refundKeys.add(key);
      ledger.balance += spent;
      ledger.events.push("refund");
      return { refunded: true };
    },
    finishJob: noop, markAssetReady: noop, recordUsageEvent: noop, finishGenerationRequestSuccess: noop, purgeResumableJobStorage: noop,
  } as unknown as MeteredLifecycleOps;
}

/** The request row + the user-facing cancel endpoint's decision order (cancel route in miniature). */
class Attempt {
  row: CancelRow = { cancel_allowed: true, cancel_requested: false };
  falCancelsFromEndpoint = 0; // must stay 0: the generate route owns the Fal cancel
  traces: string[] = [];
  get locked(): boolean { return !this.row.cancel_allowed; }
  /** POST /api/generations/cancel */
  postCancel(): "cancelling" | "already_cancelling" | 409 {
    if (this.row.cancel_requested) return "already_cancelling";
    if (this.locked) { this.traces.push("cancel_refused"); return 409; }
    const r = casRequestCancel(this.row);
    this.row = r.row;
    if (!r.accepted) { this.traces.push("cancel_refused"); return 409; }
    this.traces.push("cancel_requested");
    return "cancelling";
  }
  hooks() {
    let queueLocked = false;
    return {
      abortCheck: async () => { if (this.row.cancel_requested && !this.locked) throw new GenerationCancelledError(); },
      commit: async ({ ifNoCancel }: { ifNoCancel: boolean }) => {
        if (!ifNoCancel) { this.row = forceCommitRow(); queueLocked = true; return true; }
        if (!queueLocked) { const r = casLockUnlessCancelRequested(this.row); this.row = r.row; queueLocked = r.locked; }
        return queueLocked;
      },
      onCancelAttempt: (a: { result: string; confirmed: boolean }) => this.traces.push(`cancel_outcome:${a.result}:${a.confirmed}`),
    };
  }
}

type Outcome = { delivered: number; cancelled: boolean; ledger: Ledger; attempt: Attempt };

/** One request with `fal.scripts.length` images, settled through the real settlement path. */
async function generate(scripts: Phase[][], cancel: Cancel, userCancelAtTick: number | null, opts: { log?: string[]; settleTwice?: boolean } = {}): Promise<Outcome> {
  const log = opts.log ?? [];
  const attempt = new Attempt();
  const n = scripts.length;
  const ledger: Ledger = { events: ["spend"], balance: 100 - COST * n, refundKeys: new Set() };
  const fal = makeFal(scripts, cancel, log, (t) => { if (userCancelAtTick === t) attempt.postCancel(); });
  const provider = createFalPhotoProvider(fal, 0);
  const handle = { profileId: "p", userId: "u", jobId: "job-1", generationRequestId: "req-1", creditsSpent: true, creditsAmount: COST * n, assetIds: [], refundJobType: "product_photo" };
  const metered = ops(ledger, () => attempt.locked, COST * n);
  const outcomes = await Promise.allSettled(
    scripts.map(async () => {
      const url = await provider.run({ model: "fal-ai/nano-banana", input: INPUT, hooks: attempt.hooks() });
      await attempt.hooks().commit({ ifNoCancel: false }); // route: commitProviderOnce() after output
      return url;
    }),
  );
  const successes = outcomes.filter((o) => o.status === "fulfilled").length;
  const rejections = outcomes.flatMap((o) => (o.status === "rejected" ? [o.reason] : []));
  if (successes > 0) {
    const plan = planBatchFailures({ rejections, commitsOnSubmit: true, cancelWhileQueued: true, isDefinitive: isProviderDefinitiveFailure, isCancelled: isGenerationCancelled });
    if (plan.refundableFailures > 0) { ledger.balance += COST * plan.refundableFailures; ledger.events.push("partial-refund"); }
    await finishMeteredAttemptWithOps(handle, { kind: "success", responseJson: {} }, metered);
    return { delivered: successes, cancelled: false, ledger, attempt };
  }
  const plan = planBatchFailures({ rejections, commitsOnSubmit: true, cancelWhileQueued: true, isDefinitive: isProviderDefinitiveFailure, isCancelled: isGenerationCancelled });
  const reason = plan.fullyCancelled ? rejections[0] : (plan.ambiguous ?? rejections[0]);
  const cancelled = isGenerationCancelled(reason) && isRefundableUserCancellationPure(true, attempt.locked, true);
  const terminal = {
    kind: "terminal" as const, cancelled, rawMessage: "failed",
    definitiveProviderFailure: !cancelled && isProviderDefinitiveFailure(reason), commitsOnSubmit: true,
  };
  await finishMeteredAttemptWithOps(handle, terminal, metered);
  if (opts.settleTwice) await finishMeteredAttemptWithOps(handle, terminal, metered);
  return { delivered: 0, cancelled, ledger, attempt };
}

async function main(): Promise<void> {
  // --- Fal cancel answers (queue OpenAPI): only 200 OK is a removal.
  assert(classifyFalCancel(200, "OK") === "removed", "200 OK = removed");
  assert(classifyFalCancel(202, "CANCELLATION_REQUESTED") === "signalled", "202 = signalled, not cancelled");
  assert(classifyFalCancel(400, "ALREADY_COMPLETED") === "already_completed", "400 = too late");
  assert(classifyFalCancel(200, undefined) === "unknown" && classifyFalCancel(404, "NOT_FOUND") === "unknown" && classifyFalCancel(500) === "unknown", "anything else is unknown");

  // --- CAS between requestCancel and the commit lock, both orders (one atomic statement each).
  {
    const open: CancelRow = { cancel_allowed: true, cancel_requested: false };
    const cancelFirst = casRequestCancel(open);
    assert(cancelFirst.accepted && !casLockUnlessCancelRequested(cancelFirst.row).locked, "cancel first: the lock CAS fails and follows the cancel");
    assert(casLockUnlessCancelRequested(cancelFirst.row).row.cancel_requested, "failed lock leaves the cancel flag");
    const lockFirst = casLockUnlessCancelRequested(open);
    assert(lockFirst.locked && !casRequestCancel(lockFirst.row).accepted, "lock first: cancel is refused");
    assert(casLockUnlessCancelRequested(lockFirst.row).locked, "locking twice is idempotent");
    const forced = forceCommitRow();
    assert(!forced.cancel_allowed && !forced.cancel_requested, "force commit locks and clears the cancel flag");
    // The DB statements carry the same predicates.
    const cancelSrc = readFileSync("lib/generation-cancel.ts", "utf8");
    const commitSrc = readFileSync("lib/generation-commit.ts", "utf8");
    assert(/\.eq\("cancel_allowed", true\)/.test(cancelSrc), "requestCancel only where cancel_allowed");
    assert(/update\(\{ cancel_allowed: false \}\)[\s\S]*\.eq\("cancel_allowed", true\)[\s\S]*\.eq\("cancel_requested", false\)/.test(commitSrc), "lock CAS only where not cancel_requested");
    const routeSrc = readFileSync("app/api/generations/cancel/route.ts", "utf8");
    assert(routeSrc.includes('cancelRecordedPredictions(profileId, existing.id, ["fal"])'), "cancel endpoint leaves the Fal cancel to the generate route");
  }

  // 1. Cancel while queued, Fal confirms => one refund, job cancelled, no image, one Fal cancel; retry adds no refund.
  {
    const log: string[] = [];
    const r = await generate([["IN_QUEUE"]], "honor", 2, { log, settleTwice: true });
    assert(r.cancelled && r.delivered === 0, "1: cancelled, no image");
    assert(r.ledger.events.join() === "spend,refund" && r.ledger.balance === 100, "1: exactly one refund, balance restored");
    assert(log.filter((l) => l.startsWith("fal-cancel")).length === 1, "1: single Fal cancel");
    assert(r.attempt.traces.join() === "cancel_requested,cancel_outcome:removed:true", "1: trace requested + confirmed");
  }

  // 2. Cancel while running => 409, charged once, delivered, Fal never cancelled.
  {
    const log: string[] = [];
    const r = await generate([["IN_QUEUE", "IN_PROGRESS", "IN_PROGRESS", "COMPLETED"]], "honor", 4, { log });
    assert(!r.cancelled && r.delivered === 1 && r.ledger.events.join() === "spend" && r.ledger.balance === 95, "2: charged once, delivered, no refund");
    assert(!log.some((l) => l.startsWith("fal-cancel")), "2: no Fal cancel after the lock");
    assert(r.attempt.traces.join() === "cancel_refused", "2: the 409 is traced");
    const a = new Attempt();
    a.row = casLockUnlessCancelRequested(a.row).row;
    assert(a.postCancel() === 409, "2: cancel POST after the lock is 409 CANCEL_NOT_ALLOWED");
  }

  // 3. Races with the lock / completion: never refund + image, never charge without image.
  {
    const running = await generate([["IN_QUEUE", "IN_PROGRESS", "IN_PROGRESS", "COMPLETED"]], "honor", 2); // cancel lands before the lock CAS
    assert(!running.cancelled && running.delivered === 1 && running.ledger.events.join() === "spend", "3a: cancel beat the lock but the run was already going: signalled => committed, delivered, charged");
    assert(running.attempt.traces.join() === "cancel_requested,cancel_outcome:signalled:false", "3a: raced trace");
    const completing = await generate([["IN_QUEUE", "COMPLETED"]], "honor", 2);
    assert(!completing.cancelled && completing.delivered === 1 && completing.ledger.events.join() === "spend", "3b: cancel races completion => already completed, delivered, no refund");
    assert(completing.attempt.traces.join() === "cancel_requested,cancel_outcome:already_completed:false", "3b: trace");
    // Fal says removed but the output exists anyway: positive confirmation fails => committed.
    const liar = await generate([["IN_QUEUE", "COMPLETED"]], "removed_but_completes", 2);
    assert(liar.delivered === 1 && !liar.cancelled && liar.ledger.events.join() === "spend", "3c: removed-but-completed delivers and charges, no refund");
  }

  // 4. Cancel not confirmed (error / 202) => treated as committed.
  for (const cancel of ["network", "signalled"] as const) {
    const r = await generate([["IN_QUEUE", "IN_QUEUE", "COMPLETED"]], cancel, 2);
    assert(!r.cancelled && r.delivered === 1 && r.ledger.events.join() === "spend" && r.ledger.balance === 95, `4: ${cancel}: charged, delivered, no refund`);
    assert(r.attempt.locked && !r.attempt.row.cancel_requested, `4: ${cancel}: committed (locked, flag cleared)`);
  }

  // 5. Double cancel is idempotent: second POST is already_cancelling, one Fal cancel, one refund.
  {
    const log: string[] = [];
    let attemptRef: Attempt | null = null;
    const attempt = new Attempt();
    attemptRef = attempt;
    const fal = makeFal([["IN_QUEUE"]], "honor", log, (t) => { if (t === 2) { attemptRef!.postCancel(); assert(attemptRef!.postCancel() === "already_cancelling", "5: second cancel is already_cancelling"); } });
    let cancelled = false;
    try { await createFalPhotoProvider(fal, 0).run({ model: "fal-ai/nano-banana", input: INPUT, hooks: attempt.hooks() }); } catch (e) { cancelled = isGenerationCancelled(e); }
    assert(cancelled && log.filter((l) => l.startsWith("fal-cancel")).length === 1, "5: one Fal cancel for two clicks");
    assert(attempt.traces.filter((t) => t === "cancel_requested").length === 1, "5: one cancel_requested trace");
  }

  // 6. Batch of 2.
  {
    const both = await generate([["IN_QUEUE"], ["IN_QUEUE"]], "honor", 2, { settleTwice: true });
    assert(both.cancelled && both.delivered === 0 && both.ledger.events.join() === "spend,refund" && both.ledger.balance === 100, "6a: both queued => full refund once");
    const oneRunning = await generate([["IN_PROGRESS", "IN_PROGRESS", "COMPLETED"], ["IN_QUEUE", "IN_QUEUE", "IN_QUEUE", "COMPLETED"]], "honor", 4);
    assert(oneRunning.delivered === 2 && oneRunning.ledger.events.join() === "spend" && oneRunning.ledger.balance === 90, "6b: one running => request locked, 409, both delivered and charged");
    assert(oneRunning.attempt.traces.join() === "cancel_refused", "6b: refused trace");
    // Cancel lands while image 1 just left the queue (not yet locked): image 0 is removed, 1 is committed.
    const mixed = await generate([["IN_QUEUE"], ["IN_PROGRESS", "COMPLETED"]], "honor", 1);
    assert(mixed.delivered === 1 && mixed.ledger.balance === 95 && mixed.ledger.events.join() === "spend,partial-refund", "6c: raced batch: the removed image is refunded, the delivered one charged, never charged without an image");
  }

  // 7. Client cancel(): result classification + English copy.
  {
    const mk = (status: number, body: unknown, ok = status < 300) => async () => ({ ok, status, json: async () => body });
    assert(await postGenerationCancel(mk(200, { status: "cancelling" }), "k") === "cancelling", "7: accepted");
    const refused = await postGenerationCancel(mk(409, { code: "CANCEL_NOT_ALLOWED" }), "k");
    const ui = cancelUiState(refused);
    assert(refused === "not_allowed" && ui.refused && ui.notice === CANCEL_NOT_ALLOWED_MESSAGE, "7: 409 CANCEL_NOT_ALLOWED => notice + Finalizing…");
    assert(/credits are used/i.test(CANCEL_NOT_ALLOWED_MESSAGE) && /^[\x20-\x7E]+$/.test(CANCEL_NOT_ALLOWED_MESSAGE + CANCEL_FAILED_MESSAGE), "7: English copy");
    for (const failed of [await postGenerationCancel(mk(500, {}), "k"), await postGenerationCancel(mk(409, { code: "OTHER" }), "k"), await postGenerationCancel(async () => { throw new Error("offline"); }, "k")]) {
      const u = cancelUiState(failed);
      assert(failed === "failed" && !u.refused && u.notice === CANCEL_FAILED_MESSAGE, "7: other failures show the retry notice");
    }
    assert(cancelUiState("cancelling").notice === null && cancelUiState("idle").notice === null, "7: success path shows no notice");
  }

  console.log("falCancelSelfCheck: ok");
}
void main();
