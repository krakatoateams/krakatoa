/**
 * Fal endpoints, input mapping, output normalizer and trusted output hosts for the three
 * Nano Banana photo tiers. Pure (no SDK, no env) so the self-check can run it directly.
 * Endpoint ids and field names come from fal's model pages and are NOT verified by a live
 * call yet (see the phase 4 PR notes).
 */

/** Fal media hosts. Outputs and fal-storage uploads are public, unauthenticated URLs. */
const FAL_MEDIA_HOST = "fal.media";

export function isTrustedFalOutputUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === FAL_MEDIA_HOST || url.hostname.endsWith(`.${FAL_MEDIA_HOST}`))
    );
  } catch {
    return false;
  }
}

export function assertTrustedFalOutputUrl(value: string): void {
  if (!isTrustedFalOutputUrl(value)) {
    throw new Error("Fal returned an untrusted output URL.");
  }
}

type FalPhotoModel = {
  /** model_configs config_key (tier modelRole) this model may run for. */
  configKey: string;
  /** Whether the endpoint accepts `resolution` (basic has a fixed size). */
  hasResolution: boolean;
};

/** Keyed by the text-to-image endpoint id, which is also the catalog `model`. Edit = `${id}/edit`. */
export const FAL_PHOTO_MODELS: Readonly<Record<string, FalPhotoModel>> = {
  "fal-ai/nano-banana": { configKey: "image_basic", hasResolution: false },
  "fal-ai/nano-banana-2": { configKey: "image_balanced", hasResolution: true },
  "fal-ai/nano-banana-pro": { configKey: "image_pro", hasResolution: true },
};

/**
 * Map the Replicate-shaped input built by `buildPhotoProviderInput` to a Fal call.
 * Endpoint choice follows the presence of reference images. Allowlist, not blocklist:
 * Replicate-only fields (allow_fallback_model, google_search, image_search) never leak.
 */
export function mapFalPhotoInput(
  model: string,
  input: Record<string, unknown>
): { endpoint: string; input: Record<string, unknown> } {
  const spec = FAL_PHOTO_MODELS[model];
  if (!spec) throw new Error(`Unsupported Fal photo model "${model}".`);
  const refs = Array.isArray(input.image_input) ? input.image_input : [];
  const out: Record<string, unknown> = {
    prompt: input.prompt,
    aspect_ratio: input.aspect_ratio,
    output_format: input.output_format,
    ...(spec.hasResolution && input.resolution ? { resolution: input.resolution } : {}),
    ...(refs.length ? { image_urls: refs } : {}),
  };
  return { endpoint: refs.length ? `${model}/edit` : model, input: out };
}

/** Fal output is `{ images: [{ url }] }`; returns the first URL after the host check. */
export function normalizeFalOutput(data: unknown): string {
  const images = (data as { images?: { url?: unknown }[] } | null)?.images;
  const url = images?.[0]?.url;
  if (typeof url !== "string" || !url) throw new Error("Fal did not return a valid image URL.");
  assertTrustedFalOutputUrl(url);
  return url;
}

/** Prediction ids carry the endpoint so cancel/poll (which only see the id) can address it. */
export function encodeFalPredictionId(endpoint: string, requestId: string): string {
  return `${requestId}@${endpoint}`;
}

export function decodeFalPredictionId(id: string): { endpoint: string; requestId: string } | null {
  const at = id.indexOf("@");
  if (at <= 0 || at === id.length - 1) return null;
  return { requestId: id.slice(0, at), endpoint: id.slice(at + 1) };
}
