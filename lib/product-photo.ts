import { PHOTOS_FOLDER, STORAGE_BUCKET, photosUserPrefix } from "@/lib/storage-buckets";

export const PRODUCT_PHOTO_BUCKET = STORAGE_BUCKET;
export const PRODUCT_PHOTO_ROOT = PHOTOS_FOLDER;

export const MODEL_POSES = [
  { id: "walking", label: "Walking", prompt: "walking confidently toward the camera" },
  { id: "sitting", label: "Sitting", prompt: "sitting elegantly in a relaxed pose" },
  { id: "standing", label: "Standing", prompt: "standing in a natural fashion model pose" },
  { id: "running", label: "Running", prompt: "running dynamically with energy" },
  { id: "leaning", label: "Leaning", prompt: "leaning casually against a wall or prop" },
  { id: "crouching", label: "Crouching", prompt: "crouching in a stylish editorial pose" },
] as const;

export const PHOTO_STYLES = [
  {
    id: "minimalist-studio",
    label: "Minimalist Studio",
    prompt: "clean minimalist studio backdrop, soft diffused lighting, neutral tones",
  },
  {
    id: "outdoor-lifestyle",
    label: "Outdoor Lifestyle",
    prompt: "bright outdoor lifestyle setting, natural daylight, urban or park environment",
  },
  {
    id: "neon-tech",
    label: "Neon Tech",
    prompt: "futuristic neon-lit environment, cyberpunk accents, dramatic contrast lighting",
  },
  {
    id: "luxury-marble",
    label: "Luxury Marble",
    prompt: "luxury marble surfaces, premium editorial lighting, high-end brand aesthetic",
  },
] as const;

export type ModelPoseId = (typeof MODEL_POSES)[number]["id"];
export type PhotoStyleId = (typeof PHOTO_STYLES)[number]["id"];

/**
 * Product Photo model tiers (Pricing Config v2.3).
 *
 * Three real provider models, each its own credit price:
 *   - basic    -> google/nano-banana       (NO resolution param)        4 cr
 *   - balanced -> google/nano-banana-2      (resolution 1K/2K/4K)   7/10/14 cr
 *   - pro      -> google/nano-banana-pro    (resolution 1K/2K/4K)  14/14/27 cr
 *
 * The credit charge is provider-cost based (lib/pricing-defaults.ts +
 * lib/pricing-resolver.ts) at the current factor-90 billing knobs. `fallbackCredits`
 * is a UI safety value only — the backend always charges via the resolver.
 *
 * The route maps the tier to a model_configs role (image_basic/image_balanced/
 * image_pro) and, for Balanced/Pro, sends the provider `resolution` enum
 * ("1K"/"2K"/"4K"). Basic sends no resolution. We never invent unsupported params.
 */

export type ProductPhotoModelTier =
  | "basic"
  | "balanced"
  | "pro"
  | "seedream4"
  | "flux_kontext"
  | "flux11"
  | "imagen4"
  | "ideogram3"
  | "seedream3"
  | "flux_schnell";
export type ProductPhotoResolution = "1k" | "2k" | "4k";

/**
 * Provider input "family" — describes how to build the Replicate input for a
 * model, since each model family accepts different parameters (reference image
 * param name, resolution support, extra flags). Used by buildPhotoProviderInput.
 */
export type PhotoProviderFamily =
  | "nano_basic"
  | "nano_balanced"
  | "nano_pro"
  | "seedream"
  | "flux_kontext"
  | "flux_t2i"
  | "imagen"
  | "ideogram";

export const DEFAULT_PRODUCT_PHOTO_TIER: ProductPhotoModelTier = "basic";
export const DEFAULT_PRODUCT_PHOTO_RESOLUTION: ProductPhotoResolution = "1k";

/**
 * Aspect ratios offered by the omni-form (/tools/photo-v2). These map 1:1 to the
 * `aspect_ratio` enum accepted by the Nano Banana family on Replicate, so the
 * selected value can be forwarded to the provider verbatim.
 */
export type PhotoAspectRatio =
  | "1:1"
  | "3:4"
  | "2:3"
  | "9:16"
  | "3:2"
  | "4:3"
  | "16:9"
  | "21:9";

export const PHOTO_ASPECT_RATIOS: { id: PhotoAspectRatio; label: string; cinematic?: boolean }[] = [
  { id: "1:1", label: "1:1" },
  { id: "3:4", label: "3:4" },
  { id: "2:3", label: "2:3" },
  { id: "9:16", label: "9:16" },
  { id: "3:2", label: "3:2" },
  { id: "4:3", label: "4:3" },
  { id: "16:9", label: "16:9", cinematic: true },
  { id: "21:9", label: "21:9", cinematic: true },
];

export const DEFAULT_PHOTO_ASPECT_RATIO: PhotoAspectRatio = "1:1";

export function isValidPhotoAspectRatio(id: string): id is PhotoAspectRatio {
  return PHOTO_ASPECT_RATIOS.some((a) => a.id === id);
}

/** UI resolution id -> provider `resolution` enum value. */
const PROVIDER_RESOLUTION: Record<ProductPhotoResolution, string> = {
  "1k": "1K",
  "2k": "2K",
  "4k": "4K",
};

export type ProductPhotoResolutionOption = {
  id: ProductPhotoResolution;
  label: string;
  pricingKey: string;
  fallbackCredits: number;
};

export type ProductPhotoTier = {
  id: ProductPhotoModelTier;
  label: string;
  subtitle: string;
  /** Friendly model name shown in the omni-form model chip. */
  modelLabel: string;
  /** model_configs config_key for this tier. */
  modelRole: string;
  /** Provider model id (display/metadata only; resolved via model_configs). */
  providerModel: string;
  hasResolution: boolean;
  /** Single pricing key for a no-resolution tier (basic + extended models). */
  basicPricingKey?: string;
  basicFallbackCredits?: number;
  /** Per-resolution pricing keys (balanced/pro). */
  resolutions: ProductPhotoResolutionOption[];
  /** Provider input family — how to build the Replicate input for this model. */
  providerFamily: PhotoProviderFamily;
  /** Whether the model accepts a product reference image (usable in Product Try-on). */
  supportsReference: boolean;
  /** Replicate input param for the reference image (only when supportsReference). */
  referenceParam?: "image_input" | "input_image";
  /** Subset of aspect ratios the provider accepts; undefined = all are supported. */
  supportedAspectRatios?: PhotoAspectRatio[];
  /** Show this tier in the legacy /tools/photo "Photo backup" tier grid. */
  legacyPicker?: boolean;
};

export const PRODUCT_PHOTO_TIERS: ProductPhotoTier[] = [
  {
    id: "basic",
    label: "Basic",
    subtitle: "Fast · Nano Banana",
    modelLabel: "Nano Banana",
    modelRole: "image_basic",
    providerModel: "google/nano-banana",
    hasResolution: false,
    basicPricingKey: "product_photo_nano_banana_per_image",
    basicFallbackCredits: 4,
    resolutions: [],
    providerFamily: "nano_basic",
    supportsReference: true,
    referenceParam: "image_input",
    legacyPicker: true,
  },
  {
    id: "balanced",
    label: "Balanced",
    subtitle: "Best value · Nano Banana 2",
    modelLabel: "Nano Banana 2",
    modelRole: "image_balanced",
    providerModel: "google/nano-banana-2",
    hasResolution: true,
    resolutions: [
      { id: "1k", label: "1K", pricingKey: "product_photo_nano_banana_2_1k_per_image", fallbackCredits: 7 },
      { id: "2k", label: "2K", pricingKey: "product_photo_nano_banana_2_2k_per_image", fallbackCredits: 10 },
      { id: "4k", label: "4K", pricingKey: "product_photo_nano_banana_2_4k_per_image", fallbackCredits: 14 },
    ],
    providerFamily: "nano_balanced",
    supportsReference: true,
    referenceParam: "image_input",
    legacyPicker: true,
  },
  {
    id: "pro",
    label: "Pro",
    subtitle: "Highest quality · Nano Banana Pro",
    modelLabel: "Nano Banana Pro",
    modelRole: "image_pro",
    providerModel: "google/nano-banana-pro",
    hasResolution: true,
    resolutions: [
      { id: "1k", label: "1K", pricingKey: "product_photo_nano_banana_pro_1k_per_image", fallbackCredits: 14 },
      { id: "2k", label: "2K", pricingKey: "product_photo_nano_banana_pro_2k_per_image", fallbackCredits: 14 },
      { id: "4k", label: "4K", pricingKey: "product_photo_nano_banana_pro_4k_per_image", fallbackCredits: 27 },
    ],
    providerFamily: "nano_pro",
    supportsReference: true,
    referenceParam: "image_input",
    legacyPicker: true,
  },
  // --- Extended models (omni-form /tools/photo-v2). No resolution tiers; single
  // per-image price each. Reference-capable models also work in Product Try-on. ---
  {
    id: "seedream4",
    label: "Seedream 4",
    subtitle: "Reference + text-to-image",
    modelLabel: "Seedream 4",
    modelRole: "image_seedream4",
    providerModel: "bytedance/seedream-4",
    hasResolution: false,
    basicPricingKey: "product_photo_seedream_4_per_image",
    basicFallbackCredits: 3,
    resolutions: [],
    providerFamily: "seedream",
    supportsReference: true,
    referenceParam: "image_input",
  },
  {
    id: "flux_kontext",
    label: "FLUX Kontext Pro",
    subtitle: "Reference image editing",
    modelLabel: "FLUX Kontext Pro",
    modelRole: "image_flux_kontext",
    providerModel: "black-forest-labs/flux-kontext-pro",
    hasResolution: false,
    basicPricingKey: "product_photo_flux_kontext_pro_per_image",
    basicFallbackCredits: 4,
    resolutions: [],
    providerFamily: "flux_kontext",
    supportsReference: true,
    referenceParam: "input_image",
  },
  {
    id: "flux11",
    label: "FLUX 1.1 Pro",
    subtitle: "Text-to-image",
    modelLabel: "FLUX 1.1 Pro",
    modelRole: "image_flux_1_1_pro",
    providerModel: "black-forest-labs/flux-1.1-pro",
    hasResolution: false,
    basicPricingKey: "product_photo_flux_1_1_pro_per_image",
    basicFallbackCredits: 4,
    resolutions: [],
    providerFamily: "flux_t2i",
    supportsReference: false,
  },
  {
    id: "imagen4",
    label: "Imagen 4",
    subtitle: "Text-to-image",
    modelLabel: "Imagen 4",
    modelRole: "image_imagen_4",
    providerModel: "google/imagen-4",
    hasResolution: false,
    basicPricingKey: "product_photo_imagen_4_per_image",
    basicFallbackCredits: 4,
    resolutions: [],
    providerFamily: "imagen",
    supportsReference: false,
    supportedAspectRatios: ["1:1", "9:16", "16:9", "3:4", "4:3"],
  },
  {
    id: "ideogram3",
    label: "Ideogram v3 Turbo",
    subtitle: "Great text rendering",
    modelLabel: "Ideogram v3",
    modelRole: "image_ideogram_v3_turbo",
    providerModel: "ideogram-ai/ideogram-v3-turbo",
    hasResolution: false,
    basicPricingKey: "product_photo_ideogram_v3_turbo_per_image",
    basicFallbackCredits: 3,
    resolutions: [],
    providerFamily: "ideogram",
    supportsReference: false,
    supportedAspectRatios: ["1:1", "9:16", "16:9", "3:4", "4:3", "2:3", "3:2"],
  },
  {
    id: "seedream3",
    label: "Seedream 3",
    subtitle: "Text-to-image",
    modelLabel: "Seedream 3",
    modelRole: "image_seedream3",
    providerModel: "bytedance/seedream-3",
    hasResolution: false,
    basicPricingKey: "product_photo_seedream_3_per_image",
    basicFallbackCredits: 3,
    resolutions: [],
    providerFamily: "seedream",
    supportsReference: false,
  },
  {
    id: "flux_schnell",
    label: "FLUX Schnell",
    subtitle: "Fastest · lowest cost",
    modelLabel: "FLUX Schnell",
    modelRole: "image_flux_schnell",
    providerModel: "black-forest-labs/flux-schnell",
    hasResolution: false,
    basicPricingKey: "product_photo_flux_schnell_per_image",
    basicFallbackCredits: 1,
    resolutions: [],
    providerFamily: "flux_t2i",
    supportsReference: false,
  },
];

const TIER_BY_ID = Object.fromEntries(
  PRODUCT_PHOTO_TIERS.map((t) => [t.id, t])
) as Record<ProductPhotoModelTier, ProductPhotoTier>;

export function getProductPhotoTier(modelTier: ProductPhotoModelTier): ProductPhotoTier {
  return TIER_BY_ID[modelTier] ?? TIER_BY_ID[DEFAULT_PRODUCT_PHOTO_TIER];
}

export function isValidProductPhotoTier(id: string): id is ProductPhotoModelTier {
  return PRODUCT_PHOTO_TIERS.some((t) => t.id === id);
}

/**
 * Whether a tier can consume more than one reference image. Product Try-on with a
 * separate character/model image needs this (the references are [product, character]).
 * FLUX Kontext takes a single `input_image`, so it would silently drop the character.
 */
export function tierSupportsMultiReference(tier: ProductPhotoTier): boolean {
  return tier.providerFamily !== "flux_kontext";
}

export function isValidProductPhotoResolution(id: string): id is ProductPhotoResolution {
  return id === "1k" || id === "2k" || id === "4k";
}

export function productPhotoTierHasResolution(modelTier: ProductPhotoModelTier): boolean {
  return getProductPhotoTier(modelTier).hasResolution;
}

/** Model role (config_key) for the tier. */
export function productPhotoModelRole(modelTier: ProductPhotoModelTier): string {
  return getProductPhotoTier(modelTier).modelRole;
}

/** UI resolution id -> provider resolution enum ("1K"/"2K"/"4K"), or null. */
export function productPhotoProviderResolution(
  resolution: ProductPhotoResolution | null
): string | null {
  return resolution ? PROVIDER_RESOLUTION[resolution] ?? null : null;
}

/** Pricing key for a (normalized) tier + resolution. */
export function productPhotoPricingKey(opts: {
  modelTier: ProductPhotoModelTier;
  resolution: ProductPhotoResolution | null;
}): string {
  const tier = getProductPhotoTier(opts.modelTier);
  if (!tier.hasResolution) {
    return tier.basicPricingKey ?? "product_photo_nano_banana_per_image";
  }
  const res = opts.resolution ?? DEFAULT_PRODUCT_PHOTO_RESOLUTION;
  const found = tier.resolutions.find((r) => r.id === res);
  return found?.pricingKey ?? tier.resolutions[0].pricingKey;
}

/**
 * Normalize + validate incoming options for the route.
 *   - Invalid tier -> error (route returns 400).
 *   - basic -> resolution forced to null (ignored, never a 400).
 *   - balanced/pro -> resolution required and must be 1k/2k/4k, else error (400).
 */
export function normalizeProductPhotoOptions(input: {
  modelTier: string;
  resolution?: string | null;
}):
  | { ok: true; modelTier: ProductPhotoModelTier; resolution: ProductPhotoResolution | null }
  | { ok: false; error: string } {
  if (!isValidProductPhotoTier(input.modelTier)) {
    return { ok: false, error: "Invalid model tier. Use basic, balanced, or pro." };
  }
  const tier = input.modelTier;
  if (!productPhotoTierHasResolution(tier)) {
    return { ok: true, modelTier: tier, resolution: null };
  }
  const raw = (input.resolution ?? "").toString().trim().toLowerCase();
  if (raw === "") {
    return { ok: false, error: "resolution is required for this model tier (1k, 2k, or 4k)." };
  }
  if (!isValidProductPhotoResolution(raw)) {
    return { ok: false, error: "Invalid resolution. Use 1k, 2k, or 4k." };
  }
  return { ok: true, modelTier: tier, resolution: raw };
}

export type ProductPhotoHistoryItem = {
  id: string;
  imageUrl: string;
  poseId: ModelPoseId;
  styleId: PhotoStyleId;
  poseLabel: string;
  styleLabel: string;
  createdAt: string;
  storagePath: string;
};

const POSE_BY_ID = Object.fromEntries(MODEL_POSES.map((p) => [p.id, p])) as Record<
  ModelPoseId,
  (typeof MODEL_POSES)[number]
>;
const STYLE_BY_ID = Object.fromEntries(PHOTO_STYLES.map((s) => [s.id, s])) as Record<
  PhotoStyleId,
  (typeof PHOTO_STYLES)[number]
>;

export function buildProductPhotoPrompt(
  poseId: ModelPoseId,
  styleId: PhotoStyleId,
  userPrompt?: string,
  opts?: { hasCharacterReference?: boolean }
): string {
  const pose = POSE_BY_ID[poseId];
  const style = STYLE_BY_ID[styleId];
  const direction = (userPrompt ?? "").trim();

  // When a character/model reference accompanies the product, the references are
  // sent as [product, character]. Spell out which image is which and demand
  // identity preservation so the model actually uses the selected person instead
  // of inventing a generic one.
  if (opts?.hasCharacterReference) {
    return [
      "Professional commercial product photography.",
      "The FIRST reference image is the product. The SECOND reference image is the exact person to use as the model.",
      "Use that exact person as the model — preserve their face, hairstyle, skin tone, and body type precisely; do NOT replace them with a different person.",
      `The model is ${pose.prompt}, naturally holding and showcasing the exact product from the first reference image.`,
      "Keep the product design, colors, logos, and packaging identical to the product reference — do not alter the product.",
      "Full-body or three-quarter framing, photorealistic, sharp focus on both the model and the product.",
      style.prompt,
      direction ? `Creative direction from the user: ${direction}.` : "",
      "High-end advertising quality, 4K detail.",
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    "Professional commercial product photography.",
    `A fashion model is ${pose.prompt}, naturally holding and showcasing the exact product from the reference image.`,
    "Keep the product design, colors, logos, and packaging identical to the reference — do not alter the product.",
    "Full-body or three-quarter framing, photorealistic, sharp focus on both model and product.",
    style.prompt,
    // Optional free-text creative direction from the omni-form (/tools/photo-v2).
    // Layered in as guidance without overriding the product-fidelity constraints above.
    direction ? `Creative direction from the user: ${direction}.` : "",
    "High-end advertising quality, 4K detail.",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Metadata flag marking a creation as a Character creation (omni-form). */
export const CHARACTER_CREATION_KIND = "character";

// --- Character creation options (omni-form "Character creation" mode) ---------

export type CharacterStyleId =
  | "realistic"
  | "3d"
  | "anime"
  | "pixel"
  | "cartoon"
  | "digital-art";
export const CHARACTER_STYLES: { id: CharacterStyleId; label: string; prompt: string }[] = [
  { id: "realistic", label: "Realistic", prompt: "photorealistic, lifelike detail, natural lighting" },
  { id: "3d", label: "3D", prompt: "stylized 3D render, soft global illumination, Pixar-like" },
  { id: "anime", label: "Anime", prompt: "anime illustration, clean linework, cel shading" },
  { id: "pixel", label: "Pixel art", prompt: "retro pixel art, crisp pixels, limited color palette" },
  { id: "cartoon", label: "Cartoon", prompt: "flat cartoon illustration, bold outlines, vibrant colors" },
  { id: "digital-art", label: "Digital art", prompt: "painterly digital concept art, high detail" },
];
export const DEFAULT_CHARACTER_STYLE: CharacterStyleId = "realistic";
export function isValidCharacterStyle(id: string): id is CharacterStyleId {
  return CHARACTER_STYLES.some((s) => s.id === id);
}

export type CharacterGenderId = "any" | "female" | "male" | "androgynous";
export const CHARACTER_GENDERS: { id: CharacterGenderId; label: string; prompt: string }[] = [
  { id: "any", label: "Any", prompt: "" },
  { id: "female", label: "Female", prompt: "female" },
  { id: "male", label: "Male", prompt: "male" },
  { id: "androgynous", label: "Androgynous", prompt: "androgynous" },
];
export const DEFAULT_CHARACTER_GENDER: CharacterGenderId = "any";
export function isValidCharacterGender(id: string): id is CharacterGenderId {
  return CHARACTER_GENDERS.some((g) => g.id === id);
}

// Age expressed as life-stage words (never numbers) so the model gets a clear,
// safe descriptor rather than an exact age.
export type CharacterAgeId =
  | "baby"
  | "child"
  | "teen"
  | "young-adult"
  | "adult"
  | "middle-aged"
  | "senior";
export const CHARACTER_AGES: { id: CharacterAgeId; label: string; prompt: string }[] = [
  { id: "baby", label: "Baby", prompt: "baby" },
  { id: "child", label: "Child", prompt: "young child" },
  { id: "teen", label: "Teen", prompt: "teenage" },
  { id: "young-adult", label: "Young adult", prompt: "young adult" },
  { id: "adult", label: "Adult", prompt: "adult" },
  { id: "middle-aged", label: "Middle-aged", prompt: "middle-aged" },
  { id: "senior", label: "Senior", prompt: "elderly" },
];
export const DEFAULT_CHARACTER_AGE: CharacterAgeId = "young-adult";
export function isValidCharacterAge(id: string): id is CharacterAgeId {
  return CHARACTER_AGES.some((a) => a.id === id);
}

const CHARACTER_STYLE_BY_ID = Object.fromEntries(CHARACTER_STYLES.map((s) => [s.id, s]));
const CHARACTER_GENDER_BY_ID = Object.fromEntries(CHARACTER_GENDERS.map((g) => [g.id, g]));
const CHARACTER_AGE_BY_ID = Object.fromEntries(CHARACTER_AGES.map((a) => [a.id, a]));

/**
 * Build a turnaround "character sheet" prompt so a SINGLE generated image shows
 * the same character from multiple angles (front, 3/4, side, back). Used by the
 * omni-form "Character creation" mode. The user's description (and any reference
 * image passed separately as image_input) defines the character; the optional
 * style / gender / age descriptors and the multi-angle framing are layered in so
 * one generation conveys how the character looks all around.
 */
export function buildCharacterSheetPrompt(params: {
  userPrompt?: string;
  styleId?: CharacterStyleId;
  genderId?: CharacterGenderId;
  ageId?: CharacterAgeId;
}): string {
  const desc = (params.userPrompt ?? "").trim();
  const subject = desc || "the character in the reference image";

  const style = params.styleId ? CHARACTER_STYLE_BY_ID[params.styleId] : undefined;
  const gender = params.genderId ? CHARACTER_GENDER_BY_ID[params.genderId] : undefined;
  const age = params.ageId ? CHARACTER_AGE_BY_ID[params.ageId] : undefined;
  const who = [age?.prompt, gender?.prompt].filter(Boolean).join(" ").trim();

  return [
    `Character reference turnaround sheet of ${subject}.`,
    who ? `The character is a ${who}.` : "",
    style ? `Art style: ${style.prompt}.` : "",
    "Show the SAME character from four angles in one image, evenly spaced left to right: front view, three-quarter view, side profile, and back view.",
    "Keep identical face, hair, outfit, colors, proportions, and art style across every angle.",
    "Full body, consistent soft studio lighting, clean neutral background, no text, no labels, no watermark.",
  ]
    .filter(Boolean)
    .join(" ");
}

// Fallback chains for ratios a given model may not support — pick the closest
// supported orientation rather than silently snapping everything to square.
const ASPECT_FALLBACK: Record<PhotoAspectRatio, PhotoAspectRatio[]> = {
  "1:1": ["1:1"],
  "3:4": ["3:4", "9:16"],
  "2:3": ["2:3", "3:4", "9:16"],
  "9:16": ["9:16", "3:4"],
  "3:2": ["3:2", "4:3", "16:9"],
  "4:3": ["4:3", "16:9"],
  "16:9": ["16:9", "4:3"],
  "21:9": ["21:9", "16:9"],
};

/** Clamp a requested aspect ratio to one the tier's provider actually accepts. */
export function clampAspectRatioForTier(
  tier: ProductPhotoTier,
  aspectRatio: PhotoAspectRatio
): PhotoAspectRatio {
  const supported = tier.supportedAspectRatios;
  if (!supported || supported.includes(aspectRatio)) return aspectRatio;
  for (const candidate of ASPECT_FALLBACK[aspectRatio] ?? []) {
    if (supported.includes(candidate)) return candidate;
  }
  return supported[0] ?? "1:1";
}

/**
 * Build the Replicate provider input for a Product Photo / omni-form generation.
 * Each model family accepts different params, so we only send what each supports
 * and never invent unsupported fields. The reference image is included only when
 * present and the model is reference-capable (param name varies per family).
 */
export function buildPhotoProviderInput(params: {
  tier: ProductPhotoTier;
  prompt: string;
  aspectRatio: PhotoAspectRatio;
  imageInput?: string[] | null;
  providerResolution: string | null;
}): Record<string, unknown> {
  const { tier, prompt, providerResolution } = params;
  const aspectRatio = clampAspectRatioForTier(tier, params.aspectRatio);
  const ref = params.imageInput && params.imageInput.length ? params.imageInput : null;
  const useRef = ref && tier.supportsReference;

  switch (tier.providerFamily) {
    case "nano_basic":
      return {
        prompt,
        ...(useRef ? { image_input: ref } : {}),
        aspect_ratio: aspectRatio,
        output_format: "png",
      };
    case "nano_balanced":
      return {
        prompt,
        resolution: providerResolution,
        ...(useRef ? { image_input: ref } : {}),
        aspect_ratio: aspectRatio,
        google_search: false,
        image_search: false,
        output_format: "png",
      };
    case "nano_pro":
      return {
        prompt,
        resolution: providerResolution,
        ...(useRef ? { image_input: ref } : {}),
        aspect_ratio: aspectRatio,
        output_format: "png",
        allow_fallback_model: false,
      };
    case "seedream":
      return {
        prompt,
        ...(useRef ? { image_input: ref } : {}),
        aspect_ratio: aspectRatio,
      };
    case "flux_kontext":
      return {
        prompt,
        ...(useRef ? { input_image: ref![0] } : {}),
        aspect_ratio: aspectRatio,
        output_format: "png",
      };
    case "flux_t2i":
      return {
        prompt,
        aspect_ratio: aspectRatio,
        output_format: "png",
      };
    case "imagen":
    case "ideogram":
    default:
      return {
        prompt,
        aspect_ratio: aspectRatio,
      };
  }
}

/** Filename: {timestamp}__{poseId}__{styleId}.png */
export function buildGeneratedFilename(
  poseId: ModelPoseId,
  styleId: PhotoStyleId,
  timestamp = Date.now()
): string {
  return `${timestamp}__${poseId}__${styleId}.png`;
}

export function parseGeneratedFilename(name: string): {
  timestamp: number;
  poseId: ModelPoseId;
  styleId: PhotoStyleId;
} | null {
  const match = /^(\d+)__([a-z-]+)__([a-z-]+)\.(png|jpg|jpeg|webp)$/i.exec(name);
  if (!match) return null;
  const [, ts, poseId, styleId] = match;
  if (!(poseId in POSE_BY_ID) || !(styleId in STYLE_BY_ID)) return null;
  return {
    timestamp: parseInt(ts, 10),
    poseId: poseId as ModelPoseId,
    styleId: styleId as PhotoStyleId,
  };
}

/** Storage prefix per authenticated user: `{userId}/photos` */
export function userStoragePrefix(userId: string): string {
  return photosUserPrefix(userId);
}

/** Photo studio output modes under `photos/{userId}/generated/{mode}/`. */
export type PhotoStudioMode = "product" | "t2i" | "character" | "storyboard";

export const PHOTO_STUDIO_MODES: PhotoStudioMode[] = [
  "product",
  "t2i",
  "character",
  "storyboard",
];

/** Map generate-photo `mode` → storage folder (image → t2i, parallel to video t2v). */
export function photoStorageModeFromGenerate(
  mode: "product" | "image" | "character",
): PhotoStudioMode {
  if (mode === "image") return "t2i";
  return mode;
}

function safePhotoModeSegment(mode: string): string {
  const safe = mode.replace(/[^a-z0-9-]/g, "");
  if (!safe) throw new Error(`Invalid photo mode: "${mode}"`);
  return safe;
}

/** `photos/{userId}/generated/{mode}/{filename}` */
export function photosGeneratedPath(
  userId: string,
  mode: PhotoStudioMode,
  filename: string,
): string {
  return `${userStoragePrefix(userId)}/generated/${safePhotoModeSegment(mode)}/${filename}`;
}

export function uploadsPath(userId: string, filename: string): string {
  return `${userStoragePrefix(userId)}/uploads/reference/${filename}`;
}

/** @deprecated Use `photosGeneratedPath(userId, mode, filename)`. */
export function generatedPath(userId: string, filename: string): string {
  return `${userStoragePrefix(userId)}/generated/${filename}`;
}

/** Storyboard sheet images: `photos/{userId}/generated/storyboard/{filename}` */
export function storyboardSheetPath(userId: string, filename: string): string {
  return photosGeneratedPath(userId, "storyboard", filename);
}

/** @deprecated Use userStoragePrefix — browser client id is no longer used for storage */
export function clientStoragePrefix(clientId: string): string {
  return userStoragePrefix(clientId);
}

export function historyItemFromPath(
  storagePath: string,
  publicUrl: string
): ProductPhotoHistoryItem | null {
  const name = storagePath.split("/").pop();
  if (!name) return null;
  const parsed = parseGeneratedFilename(name);
  if (!parsed) return null;
  const pose = POSE_BY_ID[parsed.poseId];
  const style = STYLE_BY_ID[parsed.styleId];
  return {
    id: name.replace(/\.[^.]+$/, ""),
    imageUrl: publicUrl,
    poseId: parsed.poseId,
    styleId: parsed.styleId,
    poseLabel: pose.label,
    styleLabel: style.label,
    createdAt: new Date(parsed.timestamp).toISOString(),
    storagePath,
  };
}
