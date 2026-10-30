import { EDITOR_EXPORT_ERRORS } from "@/lib/editor-export-pure";

export const CANCELLED_GENERATION_CLIENT_ERROR = "Generation cancelled.";
export const GENERIC_GENERATION_CLIENT_ERROR = "Generation failed.";
export const RECOVERABLE_GENERATION_CLIENT_ERROR =
  "Generation paused before delivery. Try again.";
export const PRICING_GENERATION_CLIENT_ERROR =
  "Pricing configuration is unavailable.";

/** Fal run settled in the route with credits held; reconcile refunds if Fal confirms the failure. */
export const PROVIDER_OUTCOME_UNKNOWN_CODE = "PROVIDER_OUTCOME_UNKNOWN";
export const PROVIDER_OUTCOME_UNKNOWN_CLIENT_ERROR =
  "We couldn't confirm the result with the provider. We're verifying it; credits are returned automatically if the run failed.";

const CLIENT_ERROR_BY_CODE: Record<string, string> = {
  GENERATION_CANCELLED: CANCELLED_GENERATION_CLIENT_ERROR,
  PIPELINE_RECOVERABLE: RECOVERABLE_GENERATION_CLIENT_ERROR,
  PRICING_CONFIG_MISSING: PRICING_GENERATION_CLIENT_ERROR,
  [PROVIDER_OUTCOME_UNKNOWN_CODE]: PROVIDER_OUTCOME_UNKNOWN_CLIENT_ERROR,
  INSUFFICIENT_CREDITS: "Insufficient credits.",
  // Editor export failure reasons are sanitized and fixed, so they are safe to show verbatim.
  ...EDITOR_EXPORT_ERRORS,
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
