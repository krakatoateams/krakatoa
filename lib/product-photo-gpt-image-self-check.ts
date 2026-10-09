import assert from "node:assert/strict";
import { getPricingDefault } from "./admin-config-resolved-defaults";
import { eligibleTiersForFeature } from "./creation-features";
import {
  PRODUCT_PHOTO_TIERS,
  buildPhotoProviderInput,
  getProductPhotoTier,
  PHOTO_ASPECT_RATIOS,
  normalizeProductPhotoOptions,
  photoAspectRatioDisplayForTier,
  photoAspectRatioOptionsForTier,
  productPhotoPricingKey,
} from "./product-photo";

const tier = getProductPhotoTier("gpt_image_2");
assert.equal(PRODUCT_PHOTO_TIERS.at(-1)?.id, "gpt_image_2", "appended at the end");
assert.equal(tier.providerModel, "openai/gpt-image-2");
assert.equal(tier.modelRole, "image_gpt_image_2");
for (const f of ["product", "image", "character", "social"] as const) {
  assert.ok(eligibleTiersForFeature(f).includes("gpt_image_2"), `eligible for ${f}`);
}

// quality is required + exact (no "auto"), resolution is ignored
for (const bad of [undefined, "", "auto", "ultra"]) {
  assert.equal(normalizeProductPhotoOptions({ modelTier: "gpt_image_2", quality: bad }).ok, false);
}
for (const q of ["low", "medium", "high"] as const) {
  const n = normalizeProductPhotoOptions({ modelTier: "gpt_image_2", quality: q, resolution: "4k" });
  assert.deepEqual(n.ok && [n.quality, n.resolution], [q, null]);
  const key = productPhotoPricingKey({ modelTier: "gpt_image_2", resolution: null, quality: q });
  assert.equal(key, `product_photo_gpt_image_2_${q}_per_image`);
  assert.ok(getPricingDefault(key), "admin reset default exists");
}
// other tiers never need quality
assert.deepEqual(normalizeProductPhotoOptions({ modelTier: "basic" }), {
  ok: true, modelTier: "basic", resolution: null, quality: null,
});

const input = buildPhotoProviderInput({
  tier, prompt: "p", aspectRatio: "21:9", providerResolution: null, quality: "high",
  imageInput: ["https://x/1.png", "https://x/2.png"],
});
assert.deepEqual(input, {
  prompt: "p", aspect_ratio: "16:9", quality: "high", output_format: "png",
  number_of_images: 1, background: "opaque", moderation: "auto",
  input_images: ["https://x/1.png", "https://x/2.png"],
});
assert.equal("input_images" in buildPhotoProviderInput({
  tier, prompt: "p", aspectRatio: "4:5", providerResolution: null, quality: "low",
}), false);
// Aspect-ratio picker: restricted for GPT Image 2 only; every other tier is unchanged.
assert.deepEqual(
  photoAspectRatioOptionsForTier(tier).map((a) => a.id),
  ["1:1", "3:4", "2:3", "9:16", "3:2", "4:3", "16:9"],
);
assert.equal(photoAspectRatioDisplayForTier(tier, "4:5"), "3:4");
assert.equal(photoAspectRatioDisplayForTier(tier, "21:9"), "16:9");
for (const other of PRODUCT_PHOTO_TIERS.filter((t) => t.id !== "gpt_image_2")) {
  assert.equal(photoAspectRatioOptionsForTier(other), PHOTO_ASPECT_RATIOS, `${other.id} keeps full picker`);
  for (const a of PHOTO_ASPECT_RATIOS) {
    assert.equal(photoAspectRatioDisplayForTier(other, a.id), a.id, `${other.id} shows selected ratio`);
  }
}
console.log("product-photo gpt-image self-check passed");
