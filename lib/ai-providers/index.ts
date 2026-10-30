import "server-only";

import type { PhotoProvider } from "./photo-provider";
import { createFalPhotoProvider } from "./fal-photo";
import { createReplicatePhotoProvider } from "./replicate-photo";

export { GenerationCancelledError, isGenerationCancelled, isProviderDefinitiveFailure } from "./errors";
export type { PhotoProvider, PhotoRunHooks } from "./photo-provider";

/** Adapter for the resolved provider (default Replicate); throws if it is not configured. */
export function getPhotoProvider(id = "replicate"): PhotoProvider {
  if (id === "fal") return createFalPhotoProvider();
  if (id === "replicate") return createReplicatePhotoProvider();
  throw new Error(`No photo provider adapter for "${id}".`);
}

/** Provider adapter for a RECORDED provider id (cancel/poll); null if unknown or not configured. */
export function getPhotoProviderById(id: string): PhotoProvider | null {
  if (id !== "replicate" && id !== "fal") return null;
  try {
    return getPhotoProvider(id);
  } catch {
    return null;
  }
}

export { cancelByRecordedProvider } from "./cancel-by-provider";
