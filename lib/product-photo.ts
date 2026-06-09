import { PHOTOS_FOLDER, STORAGE_BUCKET } from "@/lib/storage-buckets";

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

export type ProductPhotoModelTier = "basic" | "balanced" | "pro";
export type ProductPhotoResolution = "1k" | "2k" | "4k";

export const DEFAULT_PRODUCT_PHOTO_TIER: ProductPhotoModelTier = "basic";
export const DEFAULT_PRODUCT_PHOTO_RESOLUTION: ProductPhotoResolution = "1k";

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
  /** model_configs config_key for this tier. */
  modelRole: string;
  /** Provider model id (display/metadata only; resolved via model_configs). */
  providerModel: string;
  hasResolution: boolean;
  /** Single pricing key for a no-resolution tier (basic). */
  basicPricingKey?: string;
  basicFallbackCredits?: number;
  /** Per-resolution pricing keys (balanced/pro). */
  resolutions: ProductPhotoResolutionOption[];
};

export const PRODUCT_PHOTO_TIERS: ProductPhotoTier[] = [
  {
    id: "basic",
    label: "Basic",
    subtitle: "Fast · Nano Banana",
    modelRole: "image_basic",
    providerModel: "google/nano-banana",
    hasResolution: false,
    basicPricingKey: "product_photo_nano_banana_per_image",
    basicFallbackCredits: 4,
    resolutions: [],
  },
  {
    id: "balanced",
    label: "Balanced",
    subtitle: "Best value · Nano Banana 2",
    modelRole: "image_balanced",
    providerModel: "google/nano-banana-2",
    hasResolution: true,
    resolutions: [
      { id: "1k", label: "1K", pricingKey: "product_photo_nano_banana_2_1k_per_image", fallbackCredits: 7 },
      { id: "2k", label: "2K", pricingKey: "product_photo_nano_banana_2_2k_per_image", fallbackCredits: 10 },
      { id: "4k", label: "4K", pricingKey: "product_photo_nano_banana_2_4k_per_image", fallbackCredits: 14 },
    ],
  },
  {
    id: "pro",
    label: "Pro",
    subtitle: "Highest quality · Nano Banana Pro",
    modelRole: "image_pro",
    providerModel: "google/nano-banana-pro",
    hasResolution: true,
    resolutions: [
      { id: "1k", label: "1K", pricingKey: "product_photo_nano_banana_pro_1k_per_image", fallbackCredits: 14 },
      { id: "2k", label: "2K", pricingKey: "product_photo_nano_banana_pro_2k_per_image", fallbackCredits: 14 },
      { id: "4k", label: "4K", pricingKey: "product_photo_nano_banana_pro_4k_per_image", fallbackCredits: 27 },
    ],
  },
];

const TIER_BY_ID = Object.fromEntries(
  PRODUCT_PHOTO_TIERS.map((t) => [t.id, t])
) as Record<ProductPhotoModelTier, ProductPhotoTier>;

export function getProductPhotoTier(modelTier: ProductPhotoModelTier): ProductPhotoTier {
  return TIER_BY_ID[modelTier] ?? TIER_BY_ID[DEFAULT_PRODUCT_PHOTO_TIER];
}

export function isValidProductPhotoTier(id: string): id is ProductPhotoModelTier {
  return id === "basic" || id === "balanced" || id === "pro";
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

export function buildProductPhotoPrompt(poseId: ModelPoseId, styleId: PhotoStyleId): string {
  const pose = POSE_BY_ID[poseId];
  const style = STYLE_BY_ID[styleId];
  return [
    "Professional commercial product photography.",
    `A fashion model is ${pose.prompt}, naturally holding and showcasing the exact product from the reference image.`,
    "Keep the product design, colors, logos, and packaging identical to the reference — do not alter the product.",
    "Full-body or three-quarter framing, photorealistic, sharp focus on both model and product.",
    style.prompt,
    "High-end advertising quality, 4K detail.",
  ].join(" ");
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

/** Storage prefix per authenticated user: `photos/{userId}/` */
export function userStoragePrefix(userId: string): string {
  const safe = userId.replace(/[^a-zA-Z0-9-]/g, "");
  if (!safe) throw new Error("Invalid user id");
  return `${PRODUCT_PHOTO_ROOT}/${safe}`;
}

export function uploadsPath(userId: string, filename: string): string {
  return `${userStoragePrefix(userId)}/uploads/${filename}`;
}

export function generatedPath(userId: string, filename: string): string {
  return `${userStoragePrefix(userId)}/generated/${filename}`;
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
