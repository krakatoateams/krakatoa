export const CANCELLED_GENERATION_CLIENT_ERROR = "Generation cancelled.";
export const GENERIC_GENERATION_CLIENT_ERROR = "Generation failed.";
export const RECOVERABLE_GENERATION_CLIENT_ERROR =
  "Generation paused before delivery. Try again.";
export const PRICING_GENERATION_CLIENT_ERROR =
  "Pricing configuration is unavailable.";

const CLIENT_ERROR_BY_CODE: Record<string, string> = {
  GENERATION_CANCELLED: CANCELLED_GENERATION_CLIENT_ERROR,
  PIPELINE_RECOVERABLE: RECOVERABLE_GENERATION_CLIENT_ERROR,
  PRICING_CONFIG_MISSING: PRICING_GENERATION_CLIENT_ERROR,
  INSUFFICIENT_CREDITS: "Insufficient credits.",
};

function safeCode(error: Record<string, unknown>): string | null {
  return typeof error.code === "string" &&
    Object.prototype.hasOwnProperty.call(CLIENT_ERROR_BY_CODE, error.code)
    ? error.code
    : null;
}

export function generationClientErrorMessage(
  error: Record<string, unknown> | null | undefined
): string | null {
  if (!error) return null;
  const code = safeCode(error);
  return (code && CLIENT_ERROR_BY_CODE[code]) || GENERIC_GENERATION_CLIENT_ERROR;
}

export function generationClientErrorJson(
  error: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  const message = generationClientErrorMessage(error);
  if (!message || !error) return null;
  const code = safeCode(error);
  return code ? { message, code } : { message };
}
