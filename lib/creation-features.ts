import {
  PRODUCT_PHOTO_TIERS,
  DEFAULT_PRODUCT_PHOTO_TIER,
  type ProductPhotoModelTier,
} from "@/lib/product-photo";

/**
 * Creation features (Admin Config v3 — per-feature model enablement).
 *
 * A "creation type" (e.g. Photo) is made of one or more "features" (the omni-form
 * modes). Each feature can use a subset of the Photo model tiers, and an admin can
 * enable/disable each model per feature. This file is the SINGLE SOURCE OF TRUTH
 * for the feature catalog and the shipped default enablement.
 *
 * THREE DEFINITIONS MUST STAY ALIGNED (same contract as admin-config-defaults.ts):
 *   1. SQL table        — supabase/migrations/012_feature_model_enablement.sql
 *                         (creates the table; rows are materialized from code)
 *   2. Runtime fallback — lib/feature-model-configs-db.ts merges DB rows over
 *                         these code defaults; a missing row = shipped default.
 *   3. Defaults/seed     — this file (defaultFeatureModelRows()).
 *
 * The feature key values intentionally match the generate-photo `mode` field
 * ("image" | "product" | "character") so the route can map a request to a feature
 * with no extra translation.
 */

export type PhotoFeatureKey = "image" | "product" | "character";

export type CreationFeature = {
  key: PhotoFeatureKey;
  toolKey: "photo";
  label: string;
  description: string;
  /** When true, only tiers with supportsReference are eligible for this feature. */
  requiresReference: boolean;
};

export const PHOTO_FEATURES: CreationFeature[] = [
  {
    key: "image",
    toolKey: "photo",
    label: "Image generation",
    description: "Pure text-to-image (Generate any image).",
    requiresReference: false,
  },
  {
    key: "product",
    toolKey: "photo",
    label: "Product try-on",
    description: "Place a product (and optional character) into a generated scene.",
    requiresReference: true,
  },
  {
    key: "character",
    toolKey: "photo",
    label: "Character generation",
    description: "Turnaround character sheets from a prompt and/or reference.",
    requiresReference: false,
  },
];

const PHOTO_FEATURE_BY_KEY = Object.fromEntries(
  PHOTO_FEATURES.map((f) => [f.key, f])
) as Record<PhotoFeatureKey, CreationFeature>;

export function isPhotoFeatureKey(key: string): key is PhotoFeatureKey {
  return key in PHOTO_FEATURE_BY_KEY;
}

export function getPhotoFeature(key: PhotoFeatureKey): CreationFeature {
  return PHOTO_FEATURE_BY_KEY[key];
}

/**
 * Tiers a feature *could* use, based on the hard model capability (whether the
 * model accepts a reference image). Admin enablement operates within this set;
 * a text-only model can never be eligible for Product try-on.
 */
export function eligibleTiersForFeature(featureKey: PhotoFeatureKey): ProductPhotoModelTier[] {
  const requiresRef = PHOTO_FEATURE_BY_KEY[featureKey]?.requiresReference ?? false;
  return PRODUCT_PHOTO_TIERS.filter((t) => (requiresRef ? t.supportsReference : true)).map(
    (t) => t.id
  );
}

/** Shipped default selected tier for a feature (prefer the global default when eligible). */
export function defaultTierForFeature(featureKey: PhotoFeatureKey): ProductPhotoModelTier {
  const eligible = eligibleTiersForFeature(featureKey);
  if (eligible.includes(DEFAULT_PRODUCT_PHOTO_TIER)) return DEFAULT_PRODUCT_PHOTO_TIER;
  return eligible[0] ?? DEFAULT_PRODUCT_PHOTO_TIER;
}

export type FeatureModelDefault = {
  toolKey: "photo";
  featureKey: PhotoFeatureKey;
  modelTier: ProductPhotoModelTier;
  enabled: boolean;
  isDefault: boolean;
  sortOrder: number;
};

/**
 * The full shipped enablement matrix: every (feature × eligible tier) row, all
 * enabled by default, with one default tier per feature. Used to materialize DB
 * rows (admin GET) and as the runtime fallback when a row is missing.
 */
export function defaultFeatureModelRows(): FeatureModelDefault[] {
  const rows: FeatureModelDefault[] = [];
  for (const feature of PHOTO_FEATURES) {
    const eligible = eligibleTiersForFeature(feature.key);
    const defaultTier = defaultTierForFeature(feature.key);
    eligible.forEach((tier, i) => {
      rows.push({
        toolKey: "photo",
        featureKey: feature.key,
        modelTier: tier,
        enabled: true,
        isDefault: tier === defaultTier,
        sortOrder: i,
      });
    });
  }
  return rows;
}
