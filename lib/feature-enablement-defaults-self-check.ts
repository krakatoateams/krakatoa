import assert from "node:assert/strict";
import { codeDefaults, codeVideoDefaults } from "./feature-enablement-defaults";
import { defaultModelCatalogRows } from "./model-catalog-configs";
import { defaultTierForFeature, PHOTO_FEATURE_KEYS } from "./creation-features";
import { defaultModelForComposer, filterEnabledCatalog, VIDEO_COMPOSER_KEYS } from "./video-composer-features";
import { VIDEO_MODELS } from "./video-models";

// The DB-read-failure fallbacks must keep a ship-dark model hidden (real functions, only the catalog flag is injected).
const rows = defaultModelCatalogRows();
const photoDefaults = new Set<string>(PHOTO_FEATURE_KEYS.map((k) => defaultTierForFeature(k)));
const videoDefaults = new Set<string>(VIDEO_COMPOSER_KEYS.map((k) => defaultModelForComposer(k)));
const darkPhoto = rows.find((r) => r.toolKey === "photo" && !photoDefaults.has(r.modelId))!.modelId;
const darkVideo = rows.find((r) => r.toolKey === "reels" && !videoDefaults.has(r.modelId))!.modelId;
const dark = rows.map((r) => (r.modelId === darkPhoto || r.modelId === darkVideo ? { ...r, enabled: false } : r));

// Control: with nothing dark the model is offered somewhere, so the assertions below can fail.
assert.ok(PHOTO_FEATURE_KEYS.some((k) => codeDefaults(rows)[k].enabledTiers.includes(darkPhoto)));
assert.ok(VIDEO_COMPOSER_KEYS.some((k) => codeVideoDefaults(rows)[k].enabledTiers.includes(darkVideo)));

for (const k of PHOTO_FEATURE_KEYS) assert.ok(!codeDefaults(dark)[k].enabledTiers.includes(darkPhoto), `photo ${k}`);
for (const k of VIDEO_COMPOSER_KEYS) assert.ok(!codeVideoDefaults(dark)[k].enabledTiers.includes(darkVideo), `video ${k}`);

// Client fallback (enablement not loaded) lists only models shipped as offered.
const shipped = new Set(rows.filter((r) => r.enabled).map((r) => r.modelId));
assert.ok(filterEnabledCatalog(VIDEO_MODELS, "text2video", null).every((m) => shipped.has(m.id)));

console.log("feature-enablement-defaults self-check passed");
