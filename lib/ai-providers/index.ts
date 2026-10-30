import "server-only";

import type { PhotoProvider } from "./photo-provider";
import { createReplicatePhotoProvider } from "./replicate-photo";

export { GenerationCancelledError, isGenerationCancelled } from "./errors";
export type { PhotoProvider, PhotoRunHooks } from "./photo-provider";

/** Default (and only) provider is Replicate; throws if it is not configured. */
export function getPhotoProvider(): PhotoProvider {
  return createReplicatePhotoProvider();
}
