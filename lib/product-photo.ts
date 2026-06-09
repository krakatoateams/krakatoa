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
 * Product Photo quality tiers (Pricing Config v2.1). Each tier maps to a v2
 * pricing key whose provider_cost_usd drives the credit charge. `fallbackCredits`
 * is the client/UI fallback used only when the pricing API is unavailable (so
 * labels never show NaN); the backend always charges via the resolver.
 *
 * NOTE: quality currently affects PRICING only. The Nano Banana call does not yet
 * take a 1K/4K size/quality parameter — wiring the actual provider output size to
 * the selected tier is a tracked follow-up (see the v2 plan, open items).
 */
export const PRODUCT_PHOTO_QUALITIES = [
  {
    id: "standard",
    label: "Standard",
    description: "1K resolution",
    pricingKey: "product_photo_1k_per_image",
    fallbackCredits: 14,
  },
  {
    id: "ultra_4k",
    label: "Ultra 4K",
    description: "4K resolution",
    pricingKey: "product_photo_4k_per_image",
    fallbackCredits: 27,
  },
] as const;

export type ProductPhotoQuality = (typeof PRODUCT_PHOTO_QUALITIES)[number]["id"];

export const DEFAULT_PRODUCT_PHOTO_QUALITY: ProductPhotoQuality = "standard";

/**
 * Quality -> v2 pricing key. Includes the internal-only "low" tier (not shown in
 * the UI) so the backend can still accept and price it if ever requested.
 */
export const PRODUCT_PHOTO_QUALITY_KEYS: Record<string, string> = {
  standard: "product_photo_1k_per_image",
  ultra_4k: "product_photo_4k_per_image",
  low: "product_photo_fallback_per_image",
};

/** Server-side allow-list for the `quality` form field. */
export function isValidProductPhotoQuality(id: string): boolean {
  return id in PRODUCT_PHOTO_QUALITY_KEYS;
}

export function productPhotoPricingKey(quality: string): string {
  return PRODUCT_PHOTO_QUALITY_KEYS[quality] ?? PRODUCT_PHOTO_QUALITY_KEYS.standard;
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
