import assert from "node:assert/strict";
import {
  getModelDefault,
  getPricingDefault,
} from "./admin-config-resolved-defaults";
import { PIPELINE_GROUP_SPECS } from "./admin-pipeline-config";
import { buildMissingPricingConfigInsert } from "./admin-config-persistence-pure";
import { MOTION_CONTROL_MODELS } from "./motion-control-models";
import { V2_PRICING_DEFAULTS } from "./pricing-defaults";
import { PRODUCT_PHOTO_TIERS } from "./product-photo";
import { VIDEO_MODELS } from "./video-models";

const missingPricingDefaults = Object.keys(V2_PRICING_DEFAULTS).filter(
  (pricingKey) => !getPricingDefault(pricingKey)
);
assert.deepEqual(
  missingPricingDefaults,
  [],
  "every runtime pricing fallback must support admin reset"
);

const modelRoles = [
  ...VIDEO_MODELS.map((model) => ["reels", model.modelRole] as const),
  ...MOTION_CONTROL_MODELS.map((model) => ["reels", model.modelRole] as const),
  ...PRODUCT_PHOTO_TIERS.map((tier) => ["photo", tier.modelRole] as const),
  ...PIPELINE_GROUP_SPECS.flatMap((group) =>
    group.roles.map((role) => [role.modelConfigToolKey, role.configKey] as const)
  ),
];
const missingModelDefaults = modelRoles.filter(
  ([toolKey, configKey]) => !getModelDefault(toolKey, configKey)
);
assert.deepEqual(
  missingModelDefaults,
  [],
  "every registry model role must support admin reset"
);
assert.equal(
  getModelDefault("schedule", "llm")?.model,
  "openai/gpt-5",
  "Scheduler reset must match the runtime caption model"
);

const insert = buildMissingPricingConfigInsert(
  "product_photo_seedream_4_per_image",
  { credit_amount: 9, enabled: false },
  "admin-profile"
);
assert.equal(insert?.credit_amount, 9);
assert.equal(insert?.enabled, false);
assert.equal(insert?.cost_unit, "per_image");
for (const pricingKey of [
  "product_photo",
  "storyboard_image",
  "storyboard_video",
  "seedance_video_per_second",
  "veo_video_per_second",
  "product_photo_fallback_per_image",
  "product_photo_1k_per_image",
  "product_photo_2k_per_image",
  "product_photo_4k_per_image",
]) {
  assert.equal(
    buildMissingPricingConfigInsert(pricingKey, {}, "admin-profile")
      ?.is_deprecated,
    true,
    `materializing ${pricingKey} must preserve its deprecated status`
  );
}
assert.equal(
  buildMissingPricingConfigInsert("not_a_canonical_price", {}, "admin-profile"),
  null,
  "unknown pricing keys must not become rows"
);

console.log("admin-config persistence self-check passed");
