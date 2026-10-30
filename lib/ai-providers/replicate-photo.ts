import "server-only";

import { cancelReplicatePredictions } from "@/lib/generation-cancel";
import { uploadProductImageToReplicate } from "@/lib/replicate-product-image";
import { createReplicateClient, extractMediaUrl, runWithRetry } from "@/lib/replicate-utils";
import type { PhotoProvider } from "./photo-provider";

/** Replicate adapter: thin wrapper over the existing client/retry code, no behavior change. */
export function createReplicatePhotoProvider(): PhotoProvider {
  const replicate = createReplicateClient();
  return {
    id: "replicate",
    uploadReference: (file) => uploadProductImageToReplicate(replicate, file),
    run: async ({ model, input, hooks, maxRetries = 10 }) =>
      extractMediaUrl(await runWithRetry(replicate, model, { input }, maxRetries, hooks)),
    cancelPredictions: (ids) => cancelReplicatePredictions(replicate, ids),
    getPredictionStatus: async (id) => {
      const p = await replicate.predictions.get(id);
      return { id: p.id, status: p.status, ...(p.error ? { error: String(p.error) } : {}) };
    },
  };
}
