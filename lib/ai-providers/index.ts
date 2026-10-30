import "server-only";

import type { PhotoProvider } from "./photo-provider";
import { createReplicatePhotoProvider } from "./replicate-photo";

export { GenerationCancelledError, isGenerationCancelled } from "./errors";
export type { PhotoProvider, PhotoRunHooks } from "./photo-provider";

/** Default (and only) provider is Replicate; throws if it is not configured. */
export function getPhotoProvider(): PhotoProvider {
  return createReplicatePhotoProvider();
}

/** Provider adapter for a RECORDED provider id (cancel/poll); null if unknown or not configured. */
export function getPhotoProviderById(id: string): PhotoProvider | null {
  if (id !== "replicate") return null;
  try {
    return createReplicatePhotoProvider();
  } catch {
    return null;
  }
}

export { cancelByRecordedProvider } from "./cancel-by-provider";
