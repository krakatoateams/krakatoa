import { isSupportedProviderModel } from "@/lib/ai-provider-catalog";
import { ModelStateUnavailableError } from "@/lib/model-state-unavailable";

/** The model_configs fields the Fal-only decision reads. */
export type FalOnlyConfigRow = {
  provider: string;
  model: string;
  enabled: boolean;
};

/**
 * Resolve a Fal-only Photo tier (#467). Unlike every other tier there is no Replicate equivalent,
 * so this NEVER falls back: anything but a usable, catalog-listed Fal row with FAL_KEY present
 * throws `ModelStateUnavailableError`, which the route turns into the retryable 503 before any
 * job, spend or provider call. A Fal id therefore never reaches Replicate.
 *
 * `state` is null when the model_configs read failed (or timed out); `state.row` is the tier's row,
 * or undefined when it is missing. Pure, so the self-check runs it without a database.
 */
export function resolveFalOnlyPhotoModel(
  configKey: string,
  state: { row: FalOnlyConfigRow | null | undefined } | null,
  falConfigured: boolean
): { provider: "fal"; model: string; parameters: Record<string, unknown> } {
  const row = state?.row;
  const usable =
    state !== null &&
    row?.enabled === true &&
    row.provider === "fal" &&
    isSupportedProviderModel("fal", row.model, { toolKey: "photo", configKey }) &&
    falConfigured;
  if (!usable) throw new ModelStateUnavailableError();
  // The Fal mapper builds the input from the catalog, so stored parameters are never used.
  return { provider: "fal", model: row!.model, parameters: {} };
}
