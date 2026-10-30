import { createFalClient } from "@fal-ai/client";
import { ApiError } from "@fal-ai/client";
import { GenerationCancelledError, ProviderDefinitiveFailureError } from "./errors";
import {
  decodeFalPredictionId,
  encodeFalPredictionId,
  mapFalPhotoInput,
  normalizeFalOutput,
} from "./fal-photo-catalog";
import { classifyFalCancel, isDefinitiveFalApiError, type FalCancelResult } from "./fal-cancel-pure";
import type { PhotoProvider } from "./photo-provider";

/** The slice of the Fal client the adapter uses (injectable for the self-check). */
export type FalQueueLike = {
  queue: {
    submit(endpoint: string, o: { input: Record<string, unknown> }): Promise<{ request_id: string }>;
    status(endpoint: string, o: { requestId: string }): Promise<{ status: string; error?: string }>;
    result(endpoint: string, o: { requestId: string }): Promise<{ data: unknown }>;
    /** Resolves Fal's answer (200 OK / 202 CANCELLATION_REQUESTED / 400 ALREADY_COMPLETED); throws on anything else. */
    cancel(endpoint: string, o: { requestId: string }): Promise<FalCancelResult>;
  };
  storage: { upload(file: Blob): Promise<string> };
};

const TICK_STATUS: Record<string, string> = {
  IN_QUEUE: "starting",
  IN_PROGRESS: "processing",
  COMPLETED: "succeeded",
};

const POLL_MS = 1000;

/**
 * Fal adapter for the Nano Banana photo tiers. Own submit/poll loop over `fal.queue` (not
 * `fal.subscribe`) so the cancel check can be awaited on every tick, like the Replicate adapter.
 * Fal queues do not 429, so `maxRetries` is unused. This adapter is the single owner of the Fal
 * cancel and its confirmation: a queued request that Fal removes (200 OK, confirmed by a follow-up
 * status/result read) throws `GenerationCancelledError`; in any other case the attempt is committed
 * (`hooks.commit`), the run completes and is charged. See docs/generation/fal-provider-runbook.md.
 */
export function createFalPhotoProvider(
  client?: FalQueueLike,
  pollMs = POLL_MS
): PhotoProvider {
  const fal: FalQueueLike =
    client ??
    (() => {
      const key = process.env.FAL_KEY;
      if (!key) throw new Error("AI provider is not configured.");
      const real = createFalClient({ credentials: key });
      return {
        queue: {
          submit: (endpoint, o) => real.queue.submit(endpoint, o),
          // `error` is documented on a failed request's COMPLETED status but missing from QueueStatus's type.
          status: async (endpoint, o) => {
            const s: { status: string; error?: unknown } = await real.queue.status(endpoint, o);
            return { status: s.status, error: typeof s.error === "string" ? s.error : undefined };
          },
          result: (endpoint, o) => real.queue.result(endpoint, o),
          // The client discards the cancel response, but 200 (removed) vs 202 (signalled) is the
          // confirmation we need, so a dedicated client records the raw answer.
          cancel: async (endpoint, o) => {
            let seen: { status: number; body?: string } = { status: 0 };
            const capture = createFalClient({
              credentials: key,
              fetch: async (input, init) => {
                const res = await fetch(input, init);
                const body = await res.clone().json().then((j: { status?: unknown }) => j?.status, () => undefined);
                seen = { status: res.status, body: typeof body === "string" ? body : undefined };
                return res;
              },
            });
            try {
              await capture.queue.cancel(endpoint, o);
            } catch (e) {
              if (!(e instanceof ApiError)) throw e;
            }
            return classifyFalCancel(seen.status, seen.body);
          },
        },
        storage: { upload: (file) => real.storage.upload(file) },
      };
    })();

  const cancelOnce = (endpoint: string, requestId: string): Promise<FalCancelResult> =>
    fal.queue.cancel(endpoint, { requestId }).catch(() => "unknown" as const);

  /**
   * Fal answered 200 OK (queued request removed). Positive confirmation also needs a follow-up read
   * that shows no output: a COMPLETED status whose result is a 4xx (documented 499 for a cancelled
   * request) or a gone (404) request. Still queued/running, or an output exists, means NOT cancelled.
   */
  const confirmRemoved = async (endpoint: string, requestId: string): Promise<boolean> => {
    try {
      const { status } = await fal.queue.status(endpoint, { requestId });
      if (status !== "COMPLETED") return false;
      await fal.queue.result(endpoint, { requestId });
      return false; // output exists: the run finished anyway
    } catch (e) {
      return isDefinitiveFalApiError(e);
    }
  };

  return {
    id: "fal",
    commitsOnSubmit: true, // failures after submit are ambiguous: only a definitive failure refunds
    cancelWhileQueued: true,
    // Fal storage URLs are public; no owner lookup is needed because the bytes come straight from the request.
    uploadReference: (file) => fal.storage.upload(file),
    run: async ({ model, input, hooks }) => {
      const { endpoint, input: falInput } = mapFalPhotoInput(model, input);
      const { request_id: requestId } = await fal.queue.submit(endpoint, { input: falInput });
      const id = encodeFalPredictionId(endpoint, requestId);
      hooks?.onPrediction?.({ id, status: "starting" });
      // ponytail: no overall deadline; the route's maxDuration bounds the wait. Add one if Fal queues stall.
      let committed = !hooks?.commit; // no lock to take (no attempt row): nothing to arbitrate
      const commit = async (ifNoCancel: boolean): Promise<boolean> => {
        if (committed) return true;
        const locked = await hooks!.commit!({ ifNoCancel });
        committed = locked;
        return locked;
      };
      try {
        for (;;) {
          const { status, error } = await fal.queue.status(endpoint, { requestId });
          // Fal reports a failed request as COMPLETED + error: a definitive failure, no output.
          if (status === "COMPLETED" && error) throw new ProviderDefinitiveFailureError();
          hooks?.onPrediction?.({ id, status: TICK_STATUS[status] ?? "processing" });
          if (!committed) {
            let cancelRequested = false;
            try {
              await hooks?.abortCheck?.();
            } catch (e) {
              if (!(e instanceof GenerationCancelledError)) throw e;
              cancelRequested = true;
            }
            // Leaving the queue (or finishing) commits, unless a cancel is already in flight.
            if (!cancelRequested && status !== "IN_QUEUE") cancelRequested = !(await commit(true));
            if (cancelRequested) {
              const result = await cancelOnce(endpoint, requestId);
              const confirmed = result === "removed" && (await confirmRemoved(endpoint, requestId));
              hooks?.onCancelAttempt?.({ result, confirmed, status });
              if (confirmed) throw new GenerationCancelledError();
              await commit(false); // refused / unconfirmed / raced with completion: the run goes on
            }
          }
          if (status === "COMPLETED") break;
          await new Promise((r) => setTimeout(r, pollMs));
        }
      } catch (e) {
        // Anything but a confirmed cancel or a definitive failure leaves the outcome unknown: lock.
        if (!(e instanceof GenerationCancelledError) && !(e instanceof ProviderDefinitiveFailureError)) {
          await commit(false).catch(() => undefined);
        }
        throw e;
      }
      // result() throws an ApiError when Fal answered that the run failed; any other throw
      // (network loss) is ambiguous and keeps the attempt locked.
      let data: unknown;
      try {
        data = (await fal.queue.result(endpoint, { requestId })).data;
      } catch (e) {
        if (e instanceof ApiError) throw new ProviderDefinitiveFailureError();
        throw e;
      }
      return normalizeFalOutput(data);
    },
    cancelPredictions: async (ids) => {
      let cancelled = 0;
      await Promise.all(
        ids.map(async (raw) => {
          const parsed = decodeFalPredictionId(raw);
          if (!parsed) return;
          try {
            const result = await fal.queue.cancel(parsed.endpoint, { requestId: parsed.requestId });
            if (result === "removed" || result === "signalled") cancelled += 1;
          } catch {
            // Best-effort by contract.
          }
        })
      );
      return { requested: ids.length, cancelled };
    },
    getPredictionStatus: async (raw) => {
      const parsed = decodeFalPredictionId(raw);
      if (!parsed) throw new Error("Unrecognized Fal prediction id.");
      const { status, error } = await fal.queue.status(parsed.endpoint, { requestId: parsed.requestId });
      if (status === "COMPLETED" && error) return { id: raw, status: "failed", error: "Fal reported the run failed." };
      if (status === "COMPLETED") {
        // Fal documents `error` on a failed COMPLETED status but it is unverified live, so also ask for
        // the result: a 4xx ApiError is a definitive failure. 5xx/408/429 and network loss stay
        // ambiguous (rethrown), so reconcile never refunds on them.
        try {
          await fal.queue.result(parsed.endpoint, { requestId: parsed.requestId });
        } catch (e) {
          if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429) {
            return { id: raw, status: "failed", error: "Fal reported the run failed." };
          }
          throw e;
        }
      }
      return { id: raw, status: TICK_STATUS[status] ?? "processing" };
    },
  };
}
