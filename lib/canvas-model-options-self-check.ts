import {
  canvasImageTierOptions,
  canvasVideoComposerKey,
  canvasVideoModelOptions,
  snapCanvasImageTier,
  snapCanvasVideoModel,
  type CanvasVideoEnablement,
} from "./canvas-model-options";
import {
  defaultVideoComposerRows,
  mapVideoComposerEnablement,
  modelEligibleForComposer,
  videoComposerModelEnabled,
  VIDEO_COMPOSER_KEYS,
  type VideoComposerKey,
} from "./video-composer-features";
import { VIDEO_MODELS } from "./video-models";
import { PRODUCT_PHOTO_TIERS } from "./product-photo";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`canvas-model-options self-check: ${msg}`);
}

function enablement(disable: Partial<Record<VideoComposerKey, string[]>> = {}, defaults: Partial<Record<VideoComposerKey, string>> = {}): CanvasVideoEnablement {
  const raw = {} as Record<VideoComposerKey, { enabledTiers: string[]; defaultTier: string }>;
  for (const key of VIDEO_COMPOSER_KEYS) raw[key] = { enabledTiers: [], defaultTier: "" };
  for (const row of defaultVideoComposerRows()) {
    if (!row.enabled || disable[row.featureKey]?.includes(row.modelTier)) continue;
    raw[row.featureKey].enabledTiers.push(row.modelTier);
    if (row.isDefault) raw[row.featureKey].defaultTier = row.modelTier;
  }
  for (const [k, v] of Object.entries(defaults)) raw[k as VideoComposerKey].defaultTier = v!;
  return mapVideoComposerEnablement(raw);
}

const all = enablement();
const withRef = canvasVideoModelOptions(true, all);
const noRef = canvasVideoModelOptions(false, all);

// Every model, both input states: anything offered is accepted by the server composer check.
for (const model of VIDEO_MODELS) {
  const key = canvasVideoComposerKey(model.id);
  if (modelEligibleForComposer(model.id, "text2video")) {
    assert(key === "text2video", `${model.id} is text2video-eligible, must use text2video`);
  } else {
    assert(key === "image2video", `${model.id} not text2video-eligible, must use image2video`);
  }
  const offeredRef = withRef.some((m) => m.id === model.id);
  const offeredPlain = noRef.some((m) => m.id === model.id);
  assert(
    offeredRef === (model.references.referenceImages > 0 && modelEligibleForComposer(model.id, key)),
    `${model.id} with-reference listing follows referenceImages > 0`
  );
  assert(offeredPlain === modelEligibleForComposer(model.id, "text2video"), `${model.id} no-reference listing`);
  for (const offered of [offeredRef && true, offeredPlain && true]) {
    if (offered) {
      assert(modelEligibleForComposer(model.id, key), `${model.id} offered but ineligible for ${key}`);
      assert(videoComposerModelEnabled(all, key, model.id), `${model.id} offered but server would reject`);
    }
  }
}
assert(!withRef.some((m) => m.id === "seedance15_pro"), "first/last-frame-only model hidden with a reference");
assert(withRef.some((m) => m.id === "seedance2_mini"), "reference-capable Seedance 2 Mini listed");
assert(noRef.some((m) => m.id === "seedance15_pro"), "Seedance 1.5 Pro listed without a reference");

// Admin disabled models are hidden; null enablement is "not ready", not "all enabled".
const dis = enablement({ text2video: ["seedance2_mini"] });
assert(!canvasVideoModelOptions(true, dis).some((m) => m.id === "seedance2_mini"), "disabled model removed (ref)");
assert(!canvasVideoModelOptions(false, dis).some((m) => m.id === "seedance2_mini"), "disabled model removed (no ref)");
assert(canvasVideoModelOptions(false, null).length === 0, "null enablement yields no options");
assert(canvasVideoModelOptions(false, enablement({ text2video: noRef.map((m) => m.id) })).length === 0, "empty enabled set -> no catalog fallback");

// Snap
const ids = noRef.map((m) => m.id);
assert(snapCanvasVideoModel(ids[1], noRef, all) === ids[1], "still-enabled model kept");
assert(snapCanvasVideoModel("gone", noRef, enablement({}, { text2video: ids[2] })) === ids[2], "admin default wins over catalog order");
assert(snapCanvasVideoModel("gone", noRef, enablement({}, { text2video: "not-listed" })) !== null, "falls back when default not listed");
assert(snapCanvasVideoModel("gone", [], all) === null, "no options -> null");
assert(snapCanvasVideoModel("seedance15_pro", withRef, all) !== "seedance15_pro", "snaps off a model hidden by a reference");

// Photo
const tiers = PRODUCT_PHOTO_TIERS.map((t) => t.id);
const photoAll = { enabledTiers: tiers, defaultTier: null };
const refTiers = canvasImageTierOptions(true, photoAll);
assert(refTiers.every((t) => t.supportsReference) && refTiers.length > 0, "reference filter applied");
assert(canvasImageTierOptions(false, photoAll).length === tiers.length, "all enabled tiers without reference");
assert(canvasImageTierOptions(false, { enabledTiers: [tiers[0]], defaultTier: null }).length === 1, "enabledTiers applied");
assert(canvasImageTierOptions(false, { enabledTiers: [], defaultTier: null }).length === 0, "empty -> none");
assert(canvasImageTierOptions(false, null).length === 0, "null -> none");
assert(snapCanvasImageTier("x", refTiers, { enabledTiers: tiers, defaultTier: refTiers[1]?.id ?? null }) === (refTiers[1]?.id ?? refTiers[0].id), "tier snaps to admin default");
assert(snapCanvasImageTier("x", [], photoAll) === null, "no tiers -> null");

console.log("canvasModelOptionsSelfCheck: ok");
