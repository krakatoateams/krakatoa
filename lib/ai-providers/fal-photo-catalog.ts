/**
 * Fal endpoints, input mapping, output normalizer and trusted output hosts for the Nano Banana,
 * GPT Image 2.5 Flare and Krea 2 Turbo (Fal-only, #467) photo tiers. Pure (no SDK, no env) so the self-check can run it directly.
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

type FalPhotoModel =
  | {
      /** model_configs config_key (tier modelRole) this model may run for. */
      configKey: string;
      /** Endpoint used when reference images are present (fal splits text-to-image and edit). */
      editEndpoint: string;
      /** How the Replicate-shaped input maps onto this model's fields. */
      family: "nano" | "gpt_image_flare";
      /** Nano only: whether the endpoint accepts `resolution` (basic has a fixed size). */
      hasResolution?: boolean;
    }
  | {
      configKey: string;
      /** Text-to-image only: no edit endpoint, and reference images are refused. */
      family: "krea_t2i";
    };

/** Keyed by the text-to-image endpoint id, which is also the catalog `model`. */
export const FAL_PHOTO_MODELS: Readonly<Record<string, FalPhotoModel>> = {
  "fal-ai/nano-banana": {
    configKey: "image_basic",
    editEndpoint: "fal-ai/nano-banana/edit",
    family: "nano",
    hasResolution: false,
  },
  "fal-ai/nano-banana-2": {
    configKey: "image_balanced",
    editEndpoint: "fal-ai/nano-banana-2/edit",
    family: "nano",
    hasResolution: true,
  },
  "fal-ai/nano-banana-pro": {
    configKey: "image_pro",
    editEndpoint: "fal-ai/nano-banana-pro/edit",
    family: "nano",
    hasResolution: true,
  },
  "openai/gpt-image-2.5/flare/text-to-image": {
    configKey: "image_gpt_image_2",
    editEndpoint: "openai/gpt-image-2.5/flare/edit",
    family: "gpt_image_flare",
  },
  // Fal-only tier (#467): the tier's `falOnly` marker keeps it off Replicate.
  "fal-ai/krea-2/turbo": {
    configKey: "image_krea2_turbo",
    family: "krea_t2i",
  },
};

/** Fal constraints for a custom `image_size` (vendor docs, not live-verified). */
const FAL_SIZE_STEP = 16;
const FAL_SIZE_MAX_EDGE = 3840;
const FAL_SIZE_MAX_RATIO = 3;
const FAL_SIZE_MIN_PIXELS = 655_360;
const FAL_SIZE_MAX_PIXELS = 8_294_400;

export function isValidFalCustomSize(width: number, height: number): boolean {
  const px = width * height;
  return (
    width % FAL_SIZE_STEP === 0 &&
    height % FAL_SIZE_STEP === 0 &&
    Math.max(width, height) <= FAL_SIZE_MAX_EDGE &&
    Math.max(width, height) / Math.min(width, height) <= FAL_SIZE_MAX_RATIO &&
    px >= FAL_SIZE_MIN_PIXELS &&
    px <= FAL_SIZE_MAX_PIXELS
  );
}

/**
 * Pixel dimensions of the Fal presets we use (vendor docs). Fal's 16:9 presets are 1024x576 =
 * 589,824 px, below the 655,360 minimum, so 16:9 and 9:16 use explicit sizes instead.
 */
export const FAL_PRESET_DIMENSIONS: Readonly<Record<string, { width: number; height: number }>> = {
  square_hd: { width: 1024, height: 1024 },
  landscape_4_3: { width: 1024, height: 768 },
  portrait_4_3: { width: 768, height: 1024 },
};

/**
 * Fixed `image_size` per Photo aspect ratio (about 1 MP each, so cost stays predictable).
 * Presets where Fal has one; custom sizes for the rest. 4:5 and 21:9 are clamped to 3:4 / 16:9
 * before this runs (same as on Replicate), so they only matter if that clamp is ever lifted.
 */
export const FAL_GPT_IMAGE_SIZES: Readonly<
  Record<string, string | { width: number; height: number }>
> = {
  "1:1": "square_hd",
  "4:3": "landscape_4_3",
  "3:4": "portrait_4_3",
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "3:2": { width: 1248, height: 832 },
  "2:3": { width: 832, height: 1248 },
  "4:5": { width: 896, height: 1120 },
  "21:9": { width: 1568, height: 672 },
};

const FAL_GPT_QUALITIES = ["low", "medium", "high"] as const;

/**
 * Krea 2 Turbo bills per megapixel ($0.008 / MP, #467), so each aspect ratio is pinned to an explicit
 * `image_size` of at most 1,000,000 px (multiples of 16). The price stays one flat credit amount:
 * at most 1 MP = at most $0.008 per image, whichever way fal rounds.
 */
export const FAL_KREA_MAX_PIXELS = 1_000_000;
export const FAL_KREA_SIZES: Readonly<Record<string, { width: number; height: number }>> = {
  "1:1": { width: 992, height: 992 },
  "4:3": { width: 1152, height: 864 },
  "3:4": { width: 864, height: 1152 },
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "3:2": { width: 1200, height: 800 },
  "2:3": { width: 800, height: 1200 },
  "4:5": { width: 880, height: 1104 },
  "21:9": { width: 1504, height: 640 },
};

/** fal's `Krea2TurboInput.prompt` maxLength; the generate route refuses longer prompts before the spend. */
export const FAL_KREA_MAX_PROMPT_CHARS = 5000;

/** Any reference image in the Replicate-shaped input (every family's field name). */
function hasReferenceInput(input: Record<string, unknown>): boolean {
  return (
    (Array.isArray(input.image_input) && input.image_input.length > 0) ||
    (Array.isArray(input.input_images) && input.input_images.length > 0) ||
    Boolean(input.input_image)
  );
}

/**
 * Map the Replicate-shaped input built by `buildPhotoProviderInput` to a Fal call.
 * Endpoint choice follows the presence of reference images. Allowlist, not blocklist:
 * Replicate-only fields (allow_fallback_model, google_search, image_search, moderation) never leak.
 */
export function mapFalPhotoInput(
  model: string,
  input: Record<string, unknown>
): { endpoint: string; input: Record<string, unknown> } {
  const spec = FAL_PHOTO_MODELS[model];
  if (!spec) throw new Error(`Unsupported Fal photo model "${model}".`);
  if (spec.family === "krea_t2i") {
    // The route rejects reference images before any spend; this is the last line of defence.
    if (hasReferenceInput(input)) throw new Error("Krea 2 Turbo does not accept reference images.");
    if (String(input.prompt ?? "").length > FAL_KREA_MAX_PROMPT_CHARS) throw new Error("Prompt too long for Krea 2 Turbo.");
    const size = FAL_KREA_SIZES[String(input.aspect_ratio)];
    if (!size) throw new Error(`Unsupported aspect ratio "${String(input.aspect_ratio)}" for Krea 2 Turbo.`);
    return {
      endpoint: model,
      input: {
        prompt: input.prompt,
        image_size: size,
        // Pinned: count, acceleration and prompt expansion change cost or output; sync_mode must
        // stay false so the output is a fal.media URL, not a data URI.
        num_images: 1,
        acceleration: "none",
        enable_prompt_expansion: false,
        enable_safety_checker: true,
        output_format: "png",
        sync_mode: false,
      },
    };
  }
  if (spec.family === "gpt_image_flare") {
    const refs = Array.isArray(input.input_images) ? input.input_images : [];
    const size = FAL_GPT_IMAGE_SIZES[String(input.aspect_ratio)];
    if (!size) throw new Error(`Unsupported aspect ratio "${String(input.aspect_ratio)}" for Fal GPT Image.`);
    // Fal defaults to high: always send the quality explicitly.
    const quality = FAL_GPT_QUALITIES.find((q) => q === input.quality);
    if (!quality) throw new Error("Fal GPT Image needs quality low, medium or high.");
    return {
      endpoint: refs.length ? spec.editEndpoint : model,
      input: {
        prompt: input.prompt,
        image_size: size,
        quality,
        background: "opaque",
        output_format: "png",
        num_images: 1,
        ...(refs.length ? { image_urls: refs } : {}),
      },
    };
  }
  const refs = Array.isArray(input.image_input) ? input.image_input : [];
  const out: Record<string, unknown> = {
    prompt: input.prompt,
    aspect_ratio: input.aspect_ratio,
    output_format: input.output_format,
    ...(spec.hasResolution && input.resolution ? { resolution: input.resolution } : {}),
    ...(refs.length ? { image_urls: refs } : {}),
  };
  return { endpoint: refs.length ? spec.editEndpoint : model, input: out };
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
