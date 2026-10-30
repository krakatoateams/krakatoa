import {
  defaultTierForFeature,
  eligibleTiersForFeature,
  PHOTO_FEATURE_KEYS,
  type PhotoFeatureKey,
} from "@/lib/creation-features";
import {
  defaultModelForComposer,
  eligibleModelsForComposer,
  VIDEO_COMPOSER_KEYS,
  type VideoComposerKey,
} from "@/lib/video-composer-features";
import { defaultModelCatalogRows, enabledIdsFromRows, type ModelCatalogDefault } from "@/lib/model-catalog-configs";
import { resolveFeatureEnablement, type FeatureEnablement } from "@/lib/feature-enablement";

/**
 * Enablement the runtime falls back to when the DB read fails: exactly what it resolves with no
 * rows. It goes through the same resolver as the DB path so ship-dark models
 * (`offeredByDefault: false`) stay hidden on failure instead of being listed and accepted.
 * Pure (no I/O); `defaults` is injectable for the self-check.
 */
export function codeDefaults(
  defaults: readonly ModelCatalogDefault[] = defaultModelCatalogRows()
): Record<PhotoFeatureKey, FeatureEnablement> {
  const catalogEnabled = enabledIdsFromRows("photo", [], defaults);
  const out = {} as Record<PhotoFeatureKey, FeatureEnablement>;
  for (const featureKey of PHOTO_FEATURE_KEYS) {
    out[featureKey] = resolveFeatureEnablement({
      eligible: eligibleTiersForFeature(featureKey),
      catalogEnabled,
      rowFor: () => undefined,
      codeDefault: defaultTierForFeature(featureKey),
    });
  }
  return out;
}

export function codeVideoDefaults(
  defaults: readonly ModelCatalogDefault[] = defaultModelCatalogRows()
): Record<VideoComposerKey, FeatureEnablement> {
  const catalogEnabled = enabledIdsFromRows("reels", [], defaults);
  const out = {} as Record<VideoComposerKey, FeatureEnablement>;
  for (const composerKey of VIDEO_COMPOSER_KEYS) {
    out[composerKey] = resolveFeatureEnablement({
      eligible: eligibleModelsForComposer(composerKey),
      catalogEnabled,
      rowFor: () => undefined,
      codeDefault: defaultModelForComposer(composerKey),
    });
  }
  return out;
}
