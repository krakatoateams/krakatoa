/**
 * Idempotency signature for a Canvas image generation. Built from the EFFECTIVE
 * values actually sent (not raw node data) so the key rotates whenever the
 * server-hashed request changes. Never includes signed URLs or other per-click values.
 */
export function canvasImageAttemptSignature(input: {
  prompt: string;
  modelTier: string;
  aspectRatio: string;
  /** Pass only when the resolution field is sent. */
  resolution?: string | null;
  /** Pass only when the quality field is sent. */
  quality?: string | null;
  refImageIds: string[];
  resolvedRefFrameCount: number;
}): string {
  return [
    input.prompt,
    input.modelTier,
    input.aspectRatio,
    input.resolution ?? "",
    input.quality ?? "",
    input.refImageIds.join(","),
    input.resolvedRefFrameCount,
  ].join("|");
}
