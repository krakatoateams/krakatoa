import { createFalClient } from "@fal-ai/client";
import { GenerationCancelledError } from "./errors";
import {
  decodeFalPredictionId,
  encodeFalPredictionId,
  mapFalPhotoInput,
  normalizeFalOutput,
} from "./fal-photo-catalog";
import type { PhotoProvider } from "./photo-provider";

/** The slice of the Fal client the adapter uses (injectable for the self-check). */
export type FalQueueLike = {
  queue: {
    submit(endpoint: string, o: { input: Record<string, unknown> }): Promise<{ request_id: string }>;
    status(endpoint: string, o: { requestId: string }): Promise<{ status: string }>;
    result(endpoint: string, o: { requestId: string }): Promise<{ data: unknown }>;
    cancel(endpoint: string, o: { requestId: string }): Promise<void>;
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
 * Fal queues do not 429, so `maxRetries` is unused. A Fal cancel is only a request (the run may
 * still finish and bill), which is why `commitsOnSubmit` is true: the route locks cancel at submit.
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
      return createFalClient({ credentials: key }) as unknown as FalQueueLike;
    })();

  return {
    id: "fal",
    commitsOnSubmit: true,
    // Fal storage URLs are public; no owner lookup is needed because the bytes come straight from the request.
    uploadReference: (file) => fal.storage.upload(file),
    run: async ({ model, input, hooks }) => {
      const { endpoint, input: falInput } = mapFalPhotoInput(model, input);
      const { request_id: requestId } = await fal.queue.submit(endpoint, { input: falInput });
      const id = encodeFalPredictionId(endpoint, requestId);
      hooks?.onPrediction?.({ id, status: "starting" });
      // ponytail: no overall deadline; the route's maxDuration bounds the wait. Add one if Fal queues stall.
      for (;;) {
        const { status } = await fal.queue.status(endpoint, { requestId });
        hooks?.onPrediction?.({ id, status: TICK_STATUS[status] ?? "processing" });
        if (status === "COMPLETED") break;
        if (hooks?.abortCheck) {
          try {
            await hooks.abortCheck();
          } catch (e) {
            if (e instanceof GenerationCancelledError) {
              await fal.queue.cancel(endpoint, { requestId }).catch(() => undefined);
            }
            throw e;
          }
        }
        await new Promise((r) => setTimeout(r, pollMs));
      }
      // result() throws when the run failed.
      return normalizeFalOutput((await fal.queue.result(endpoint, { requestId })).data);
    },
    cancelPredictions: async (ids) => {
      let cancelled = 0;
      await Promise.all(
        ids.map(async (raw) => {
          const parsed = decodeFalPredictionId(raw);
          if (!parsed) return;
          try {
            await fal.queue.cancel(parsed.endpoint, { requestId: parsed.requestId });
            cancelled += 1;
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
      const { status } = await fal.queue.status(parsed.endpoint, { requestId: parsed.requestId });
      return { id: raw, status: TICK_STATUS[status] ?? "processing" };
    },
  };
}
