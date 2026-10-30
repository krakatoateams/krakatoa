/**
 * Offline end-to-end check for the 4 switchable Photo tiers on BOTH providers (no network, no
 * FAL_KEY). Real pieces: buildPhotoProviderInput, the Fal adapter + catalog, cancelByRecordedProvider.
 * Settlement is REAL: `chargedRun` mirrors the generate-photo route glue (spend, commit lock on
 * when the Fal run leaves the queue, terminal catch) and settles through finishMeteredAttemptWithOps with the
 * real resolveMeteredSettlement and the real commit/refund policy helpers. Only I/O is faked: the
 * Fal client, a scripted Replicate-side provider, the lock flag and the ledger (which dedupes the
 * refund idempotency key like credit_transactions does). The full route against Supabase is covered
 * by the live checklist in docs/generation/fal-provider-live-test-checklist.md.
 */
import { ApiError } from "@fal-ai/client";
import { isGenerationCancelled, isProviderDefinitiveFailure } from "./errors";
import { finishMeteredAttemptWithOps, type MeteredLifecycleOps } from "../metered-generation/lifecycle-core";
import { resolveMeteredSettlement } from "../metered-generation/settlement-pure";
import {
  casLockUnlessCancelRequested,
  commitLockedFromCancelAllowed,
  forceCommitRow,
  type CancelRow,
  isRefundableUserCancellationPure,
  shouldRefundFailedBatchImage,
  shouldRefundSpentCreditsAfterFailure,
} from "../generation-commit-pure";
import { createFalPhotoProvider, type FalQueueLike } from "./fal-photo";
import { FAL_PRESET_DIMENSIONS, isValidFalCustomSize, mapFalPhotoInput } from "./fal-photo-catalog";
import { PROVIDER_OUTCOME_UNKNOWN_CLIENT_ERROR, PROVIDER_OUTCOME_UNKNOWN_CODE } from "../generation-client-error";
import { photoRefundIdempotencyKey, reconcileSettledProviderFailure, type SettledFailureOps } from "../generation-reconcile-settled";
import { cancelByRecordedProvider } from "./cancel-by-provider";
import type { PhotoProvider } from "./photo-provider";
import {
  buildPhotoProviderInput,
  PRODUCT_PHOTO_TIERS,
  type PhotoAspectRatio,
  type ProductPhotoQuality,
} from "../product-photo";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`photoE2eSelfCheck: ${msg}`);
}

/** Tier id -> Fal catalog model (the t2i endpoint id). */
const FAL_MODEL: Record<string, string> = {
  basic: "fal-ai/nano-banana",
  balanced: "fal-ai/nano-banana-2",
  pro: "fal-ai/nano-banana-pro",
  gpt_image_2: "openai/gpt-image-2.5/flare/text-to-image",
};
const RATIOS: PhotoAspectRatio[] = ["1:1", "3:4", "4:3", "2:3", "3:2", "9:16", "16:9"];
const HOST_OK = "https://v3.fal.media/files/out.png";

type Ledger = { events: string[]; balance: number; refundKeys?: Set<string>; errorCode?: string; clientError?: string };

type RunResult = { status: 200 | 402 | 409 | 500; url?: string; error?: string; locked: boolean };

/** Real settlement ops; only I/O is faked. The refund key dedupes like credit_transactions. */
function settlementOps(ledger: Ledger, cost: number, isLocked: () => boolean): MeteredLifecycleOps {
  const noop = async () => undefined;
  return {
    isProviderCommitLocked: async () => isLocked(),
    resolveMeteredSettlement,
    persistMeteredSettlementLegacy: async (plan: { refundEligible: boolean; errorJson: { code?: string } }, ctx: Record<string, unknown>) => {
      ledger.errorCode = plan.errorJson.code; // what failJob would persist on the job row
      if (!plan.refundEligible) return { refunded: false };
      const key = `refund:${String(ctx.refundJobType)}:${String(ctx.jobId)}`;
      ledger.refundKeys ??= new Set();
      if (ledger.refundKeys.has(key)) return { refunded: false };
      ledger.refundKeys.add(key);
      ledger.balance += cost;
      ledger.events.push("refund");
      return { refunded: true };
    },
    finishJob: noop,
    markAssetReady: noop,
    recordUsageEvent: noop,
    finishGenerationRequestSuccess: noop,
    purgeResumableJobStorage: noop,
  } as unknown as MeteredLifecycleOps;
}

/**
 * The generate-photo route in miniature: 402 gate, spend before submit, commit lock on the first
 * tick of a commit-on-submit provider (else after output), terminal catch settled for real.
 * `settleTwice` re-runs the terminal settlement to prove a duplicate actor cannot double refund.
 */
async function chargedRun(
  ledger: Ledger,
  cost: number,
  provider: PhotoProvider,
  model: string,
  input: Record<string, unknown>,
  hooks?: Parameters<PhotoProvider["run"]>[0]["hooks"],
  settleTwice = false
): Promise<RunResult> {
  if (ledger.balance < cost) return { status: 402, locked: false }; // no provider work, no asset
  ledger.balance -= cost;
  ledger.events.push("spend");
  let row: CancelRow = { cancel_allowed: true, cancel_requested: false }; // generation_requests flags
  let locked = false; // generation_requests.cancel_allowed === false
  const ops = settlementOps(ledger, cost, () => locked);
  const handle = {
    profileId: "p", userId: "u", jobId: "job-1", generationRequestId: "req-1",
    creditsSpent: true, creditsAmount: cost, assetIds: [], refundJobType: "product_photo",
  };
  try {
    const url = await provider.run({
      model,
      input,
      hooks: {
        ...hooks,
        // Fal locks through the same compare-and-set / unconditional commit the route uses.
        ...(provider.cancelWhileQueued
          ? {
              commit: async ({ ifNoCancel }: { ifNoCancel: boolean }) => {
                if (!ifNoCancel) row = forceCommitRow();
                else row = casLockUnlessCancelRequested(row).row;
                locked = !row.cancel_allowed;
                return locked;
              },
            }
          : {}),
      },
    });
    locked = true; // output handed back: committed
    await finishMeteredAttemptWithOps(handle, { kind: "success", responseJson: { url } }, ops);
    return { status: 200, url, locked };
  } catch (e) {
    const cancelled = isGenerationCancelled(e) && isRefundableUserCancellationPure(true, locked, true);
    const outcome = {
      kind: "terminal" as const,
      cancelled,
      rawMessage: e instanceof Error ? e.message : "failed",
      definitiveProviderFailure: !cancelled && isProviderDefinitiveFailure(e),
      commitsOnSubmit: provider.commitsOnSubmit,
    };
    const finished = await finishMeteredAttemptWithOps(handle, outcome, ops);
    if (settleTwice) await finishMeteredAttemptWithOps(handle, outcome, ops);
    ledger.clientError = String((finished.http?.body as { error?: unknown } | undefined)?.error);
    return { status: (finished.http?.status ?? 500) as 409 | 500, error: outcome.rawMessage, locked };
  }
}

type FalFailure = "none" | "status_error" | "api_error" | "network";

function fakeFal(log: string[], host = HOST_OK, failResult: boolean | FalFailure = false): FalQueueLike {
  const failure: FalFailure = failResult === true ? "api_error" : failResult === false ? "none" : failResult;
  let n = 0;
  return {
    queue: {
      submit: async (endpoint, o) => {
        log.push(`submit:${endpoint}`);
        log.push(`size:${JSON.stringify(o.input.image_size ?? null)}`);
        return { request_id: `req-${++n}` };
      },
      status: async () => (failure === "status_error" ? { status: "COMPLETED", error: "runner_server_error" } : { status: "COMPLETED" }),
      result: async () => {
        if (failure === "api_error") throw new ApiError({ message: "fal run failed", status: 500, body: {} });
        if (failure === "network") throw new Error("fetch failed");
        return { data: { images: [{ url: host }] } };
      },
      cancel: async (endpoint, o) => { log.push(`cancel:${endpoint}:${o.requestId}`); return "signalled"; },
    },
    storage: { upload: async () => HOST_OK },
  };
}

function fakeReplicate(log: string[], failWith?: Error): PhotoProvider {
  return {
    id: "replicate",
    commitsOnSubmit: false,
    cancelWhileQueued: false,
    uploadReference: async () => "https://replicate.delivery/ref.png",
    run: async ({ model }) => { log.push(`replicate-run:${model}`); if (failWith) throw failWith; return "https://replicate.delivery/out.png"; },
    cancelPredictions: async (ids) => { log.push(`replicate-cancel:${ids.join(",")}`); return { requested: ids.length, cancelled: ids.length }; },
    getPredictionStatus: async (id) => ({ id, status: "succeeded" }),
  };
}

async function main(): Promise<void> {
  const tiers = PRODUCT_PHOTO_TIERS.filter((t) => FAL_MODEL[t.id]);
  assert(tiers.length === 4, "all 4 switchable tiers exist");

  for (const tier of tiers) {
    const qualities: (ProductPhotoQuality | null)[] = tier.qualities ? tier.qualities.map((q) => q.id) : [null];
    const resolutions = tier.hasResolution ? tier.resolutions.map((r) => r.id as string) : [null];
    for (const withRef of [false, true]) {
      for (const ratio of RATIOS) {
        for (const quality of qualities) {
          for (const resolution of resolutions) {
            const tag = `${tier.id}/${withRef ? "ref" : "t2i"}/${ratio}/${quality ?? resolution ?? "-"}`;
            const input = buildPhotoProviderInput({
              tier, prompt: "p", aspectRatio: ratio,
              imageInput: withRef ? ["https://x.supabase.co/signed/a.png"] : null,
              providerResolution: resolution, quality,
            });

            // Fal: endpoint, mapped fields, valid size, recorded provider, normalized trusted output.
            const log: string[] = [];
            const ledger: Ledger = { events: [], balance: 100 };
            const ticks: string[] = [];
            const res = await chargedRun(ledger, 5, createFalPhotoProvider(fakeFal(log), 0), FAL_MODEL[tier.id], input, {
              onPrediction: (t) => ticks.push(t.id),
            });
            const supportsRef = tier.supportsReference && withRef;
            const mapped = mapFalPhotoInput(FAL_MODEL[tier.id], input);
            assert(res.url === HOST_OK, `${tag}: fal output normalized`);
            assert(ledger.events[0] === "spend" && ledger.events.length === 1, `${tag}: spend before submit, no refund on success`);
            assert(log[0] === `submit:${mapped.endpoint}` && mapped.endpoint.endsWith("/edit") === supportsRef, `${tag}: endpoint follows references`);
            assert(ticks.length > 0 && ticks.every((id) => id.includes("@")), `${tag}: prediction ids carry the endpoint`);
            const size = mapped.input.image_size as string | { width: number; height: number } | undefined;
            if (tier.providerFamily === "gpt_image") {
              const dims = typeof size === "string" ? FAL_PRESET_DIMENSIONS[size] : size;
              assert(!!dims && isValidFalCustomSize(dims.width, dims.height), `${tag}: image_size ${JSON.stringify(size)} within Fal limits`);
            }

            // Replicate: same Replicate-shaped input reaches the provider untouched.
            const rlog: string[] = [];
            const rres = await chargedRun({ events: [], balance: 100 }, 5, fakeReplicate(rlog), tier.providerModel, input);
            assert(rres.url?.startsWith("https://replicate.delivery/") === true && rlog[0] === `replicate-run:${tier.providerModel}`, `${tag}: replicate run`);
          }
        }
      }
    }

    // 402: no provider work and no spend.
    for (const p of [createFalPhotoProvider(fakeFal([]), 0), fakeReplicate([])]) {
      const log: string[] = [];
      const spy: PhotoProvider = { ...p, run: async (a) => { log.push("run"); return p.run(a); } };
      const ledger: Ledger = { events: [], balance: 1 };
      const r = await chargedRun(ledger, 5, spy, FAL_MODEL[tier.id], buildPhotoProviderInput({ tier, prompt: "p", aspectRatio: "1:1", providerResolution: tier.hasResolution ? tier.resolutions[0].id : null, quality: tier.qualities?.[0].id ?? null }));
      assert(r.status === 402 && log.length === 0 && ledger.events.length === 0 && ledger.balance === 1, `${tier.id}/${p.id}: 402 creates no provider work`);
    }

    const input = buildPhotoProviderInput({ tier, prompt: "p", aspectRatio: "1:1", providerResolution: tier.hasResolution ? tier.resolutions[0].id : null, quality: tier.qualities?.[0].id ?? null });
    // Settlement matrix through the real finish path (see chargedRun).
    const falRun = (fal: FalQueueLike, ledger: Ledger, twice = false, hooks?: Parameters<PhotoProvider["run"]>[0]["hooks"]) =>
      chargedRun(ledger, 5, createFalPhotoProvider(fal, 0), FAL_MODEL[tier.id], input, hooks, twice);
    // Replicate definitive failure (before commit) => refund.
    {
      const ledger: Ledger = { events: [], balance: 50 };
      const r = await chargedRun(ledger, 5, fakeReplicate([], new Error("prediction failed")), tier.providerModel, input);
      assert(r.status === 500 && !r.locked && ledger.events.join() === "spend,refund" && ledger.balance === 50, `${tier.id}: replicate failure refunds`);
    }
    // Fal definitive failure after submit (status error, or result() ApiError) => refund exactly once, even if settled twice.
    for (const mode of ["status_error", "api_error"] as const) {
      const ledger: Ledger = { events: [], balance: 50 };
      const r = await falRun(fakeFal([], HOST_OK, mode), ledger, true);
      assert(r.locked === (mode === "api_error"), `${tier.id}/${mode}: lock only once Fal reports COMPLETED (status error throws before it)`);
      assert(ledger.events.join() === "spend,refund" && ledger.balance === 50, `${tier.id}/${mode}: definitive Fal failure refunds exactly once`);
    }
    // Fal ambiguous (network loss on result or status, timeout) => no refund, stays locked for reconcile.
    {
      // Status read fails after the run started (network loss / platform timeout): ambiguous, locked.
      const statusDies = (msg: string): FalQueueLike => {
        const f = fakeFal([]);
        let n = 0;
        f.queue.status = async () => { if (++n > 1) throw new Error(msg); return { status: "IN_PROGRESS" }; };
        return f;
      };
      const ambiguous: [string, () => Promise<RunResult>, Ledger][] = [];
      for (const [name, make] of [
        ["network", (l: Ledger) => falRun(fakeFal([], HOST_OK, "network"), l)],
        ["status-lost", (l: Ledger) => falRun(statusDies("fetch failed"), l)],
        ["timeout", (l: Ledger) => falRun(statusDies("function timed out"), l)],
      ] as const) {
        const ledger: Ledger = { events: [], balance: 50 };
        ambiguous.push([name, () => make(ledger), ledger]);
      }
      for (const [name, go, ledger] of ambiguous) {
        const r = await go();
        assert(r.locked && r.status !== 200 && ledger.events.join() === "spend" && ledger.balance === 45, `${tier.id}/${name}: ambiguous Fal outcome keeps credits and stays locked`);
        // The route settled the job failed: it is tagged for reconcile and the user is not told it was refunded.
        assert(ledger.errorCode === PROVIDER_OUTCOME_UNKNOWN_CODE && ledger.clientError === PROVIDER_OUTCOME_UNKNOWN_CLIENT_ERROR, `${tier.id}/${name}: held failure is tagged and honestly worded`);
        // Reconcile of that failed job, real decision fn: only a Fal-confirmed failure refunds, exactly once.
        for (const [fate, falStatus, expectRefund] of [
          ["confirmed", "status_error", true],
          ["succeeded", "none", false],
          ["unreachable", "network", false],
        ] as const) {
          const l: Ledger = { events: ["spend"], balance: 45, refundKeys: new Set() };
          const fal = fakeFal([], HOST_OK, falStatus === "network" ? "none" : falStatus);
          if (falStatus === "network") fal.queue.status = async () => { throw new Error("fetch failed"); };
          const provider = createFalPhotoProvider(fal, 0);
          const reconcileOps: SettledFailureOps = {
            refundedAmount: async () => (l.events.includes("refund") ? 5 : 0),
            spendAmount: async () => 5,
            getRequestId: async () => "req-1",
            isCommitLocked: async () => true,
            confirmsFailure: async () => { try { return (await provider.getPredictionStatus("r1@fal-ai/nano-banana")).status === "failed"; } catch { return false; } },
            refund: async (p) => {
              if (l.refundKeys!.has(p.idempotencyKey)) return;
              l.refundKeys!.add(p.idempotencyKey);
              l.balance += p.amount;
              l.events.push("refund");
            },
          };
          const job = { id: "job-1", profileId: "p", costCredits: 5 };
          await reconcileSettledProviderFailure(reconcileOps, job);
          await reconcileSettledProviderFailure(reconcileOps, job); // cron re-runs
          assert(l.events.join() === (expectRefund ? "spend,refund" : "spend") && l.balance === (expectRefund ? 50 : 45), `${tier.id}/${name}/${fate}: reconcile of settled failed job`);
          if (expectRefund) {
            // The route (or a late duplicate) refunding with its own key after reconcile cannot double refund.
            assert(l.refundKeys!.has(`refund:product_photo:job-1`) && photoRefundIdempotencyKey("job-1") === `refund:product_photo:job-1`, `${tier.id}/${name}: reconcile shares the route refund key`);
          }
        }
      }
    }
    // Output produced but untrusted host: output exists => never refunded here.
    {
      const ledger: Ledger = { events: [], balance: 50 };
      const r = await falRun(fakeFal([], "https://evil.example/x.png"), ledger);
      assert(!!r.error && ledger.events.join() === "spend", `${tier.id}: untrusted-host output is not a definitive failure`);
    }
    // Cancel after submit is rejected by the real lock policy.
    assert(commitLockedFromCancelAllowed(false) && !isRefundableUserCancellationPure(true, true, true), `${tier.id}: cancel after submit rejected`);
    // Reconcile decision: stale locked job refunds only on a Fal-confirmed failure.
    {
      const base = { creditsSpent: true, creditsAmount: 5, commitLocked: true };
      assert(!shouldRefundSpentCreditsAfterFailure(base), `${tier.id}: reconcile skips unconfirmed locked job`);
      assert(shouldRefundSpentCreditsAfterFailure({ ...base, definitiveProviderFailure: true }), `${tier.id}: reconcile refunds confirmed failure`);
      const failedStatus = await createFalPhotoProvider(fakeFal([], HOST_OK, "status_error"), 0).getPredictionStatus("r1@fal-ai/nano-banana");
      const okStatus = await createFalPhotoProvider(fakeFal([]), 0).getPredictionStatus("r1@fal-ai/nano-banana");
      assert(failedStatus.status === "failed" && okStatus.status === "succeeded", `${tier.id}: getPredictionStatus surfaces Fal failure`);
      // COMPLETED without `error` (unverified live): result() ApiError 4xx is definitive; 5xx/429/network never are.
      for (const [label, err, definitive] of [
        ["422", new ApiError({ message: "bad", status: 422, body: {} }), true],
        ["500", new ApiError({ message: "x", status: 500, body: {} }), false],
        ["504", new ApiError({ message: "x", status: 504, body: {} }), false],
        ["429", new ApiError({ message: "x", status: 429, body: {} }), false],
        ["network", new Error("fetch failed"), false],
      ] as const) {
        const fal = fakeFal([]);
        fal.queue.result = async () => { throw err; };
        let st = "threw";
        try { st = (await createFalPhotoProvider(fal, 0).getPredictionStatus("r1@fal-ai/nano-banana")).status; } catch { /* ambiguous */ }
        assert((st === "failed") === definitive && (definitive || st === "threw"), `${tier.id}: reconcile status for result() ${label}`);
      }
    }
    // Batch partial refunds follow the same policy.
    assert(shouldRefundFailedBatchImage({ commitsOnSubmit: false, definitiveProviderFailure: false }), "replicate batch image refunds");
    assert(shouldRefundFailedBatchImage({ commitsOnSubmit: true, definitiveProviderFailure: true }), "fal definitive batch image refunds");
    assert(!shouldRefundFailedBatchImage({ commitsOnSubmit: true, definitiveProviderFailure: false }), "fal ambiguous batch image does not refund");

    // Cancel while queued and confirmed by Fal: see fal-cancel-self-check.ts for the full matrix.
  }

  // Cancel routing follows the RECORDED provider, whatever the config says now.
  const flog: string[] = [];
  const fal = createFalPhotoProvider(fakeFal(flog), 0);
  const rep = fakeReplicate(flog);
  const out = await cancelByRecordedProvider(
    { fal: ["r1@fal-ai/nano-banana/edit", "r2@fal-ai/nano-banana-2"], replicate: ["abc123"] },
    (id) => (id === "fal" ? fal : id === "replicate" ? rep : null)
  );
  assert(out.predictions === 3 && out.cancelled === 3, "cancel counts both providers");
  assert(flog.includes("cancel:fal-ai/nano-banana/edit:r1") && flog.includes("replicate-cancel:abc123"), "ids go to their own provider");
  assert(!flog.some((l) => l.startsWith("replicate-cancel:") && l.includes("@")), "fal ids never reach replicate");

  console.log("photoE2eSelfCheck: ok");
}
void main();
