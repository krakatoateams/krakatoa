/** Specific English message for a failed generate response that carried no JSON `error`. */
export function describeGenerateHttpError(status: number): string {
  if (status === 413) return "The reference image is too large. Try a smaller image.";
  if (status === 408 || status === 504) return "Generation took too long. Please try again.";
  if (status === 429) return "Too many requests. Please wait a moment and try again.";
  if (status >= 500) return "The server had a problem generating this image. Please try again.";
  return `Generation failed (HTTP ${status}). Please try again.`;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

if (require.main === module) {
  assert(/too large/.test(describeGenerateHttpError(413)), "status mapping");
  assert(/too long/.test(describeGenerateHttpError(504)), "status mapping");
  assert(/too long/.test(describeGenerateHttpError(408)), "status mapping");
  assert(/server had a problem/.test(describeGenerateHttpError(502)), "status mapping");
  assert(describeGenerateHttpError(400).includes("400"), "status mapping");
  console.log("canvasGenerationErrorSelfCheck: ok");
}
