/**
 * Thrown when a provider run was cancelled (user Cancel, or the provider reported
 * a cancelled status). Routes catch it to mark the job 'cancelled' (not 'failed')
 * and refund. Provider-neutral; the `code` survives serialization.
 */
export class GenerationCancelledError extends Error {
  readonly code = "GENERATION_CANCELLED";
  constructor(message = "Generation was cancelled.") {
    super(message);
    this.name = "GenerationCancelledError";
  }
}

/** Type guard for the cancellation error (also matches the code, post-serialization). */
export function isGenerationCancelled(e: unknown): e is GenerationCancelledError {
  return (
    e instanceof GenerationCancelledError ||
    (e instanceof Error && (e as { code?: unknown }).code === "GENERATION_CANCELLED")
  );
}

/**
 * The provider explicitly reported this request as failed (no output produced). The only
 * post-commit failure that still refunds; timeouts, network loss and aborts stay ambiguous.
 */
export class ProviderDefinitiveFailureError extends Error {
  readonly code = "PROVIDER_DEFINITIVE_FAILURE";
  constructor(message = "The AI provider reported that the run failed.") {
    super(message);
    this.name = "ProviderDefinitiveFailureError";
  }
}

export function isProviderDefinitiveFailure(e: unknown): boolean {
  return (
    e instanceof ProviderDefinitiveFailureError ||
    (e instanceof Error && (e as { code?: unknown }).code === "PROVIDER_DEFINITIVE_FAILURE")
  );
}
