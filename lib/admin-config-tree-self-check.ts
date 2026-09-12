import assert from "node:assert/strict";
import {
  buildAdminConfigTree,
  variantFromPricingRow,
  type ToolConfigInput,
} from "./admin-config-tree";
import {
  readRequiredAdminConfigJson,
  requireAdminConfigRows,
} from "./admin-config-load";
import { DEFAULT_BILLING_SETTINGS } from "./pricing-math";

const tools: ToolConfigInput[] = [
  {
    tool_key: "ig",
    display_name: "IG Automation",
    enabled: true,
    visible_in_sidebar: false,
    coming_soon: false,
    sort_order: 3,
  },
  {
    tool_key: "photo",
    display_name: "Product Photo",
    enabled: true,
    visible_in_sidebar: true,
    coming_soon: false,
    sort_order: 2,
  },
  {
    tool_key: "reels",
    display_name: "Video",
    enabled: true,
    visible_in_sidebar: true,
    coming_soon: false,
    sort_order: 1,
  },
  {
    tool_key: "dashboard",
    display_name: "Dashboard",
    enabled: true,
    visible_in_sidebar: true,
    coming_soon: false,
    sort_order: 0,
  },
];

const tree = buildAdminConfigTree({
  tools,
  pricing: [],
  featureModels: [
    {
      id: "fm-1",
      tool_key: "reels",
      feature_key: "text2video",
      model_tier: "seedance2_fast",
      enabled: true,
      is_default: true,
    },
    {
      id: "fm-2",
      tool_key: "reels",
      feature_key: "text2video",
      model_tier: "seedance2",
      enabled: true,
      is_default: true,
    },
  ],
  modelCatalog: [],
  modelConfigs: [],
  billingSettings: DEFAULT_BILLING_SETTINGS,
});

assert.deepEqual(
  tree.map((tool) => tool.toolKey),
  ["dashboard", "reels", "photo", "ig"],
  "the unified tree must include every tool row in persisted sort order"
);
const video = tree.find((tool) => tool.toolKey === "reels");
assert.equal(
  video?.models.flatMap((model) => model.features)
    .filter((feature) => feature.key === "text2video" && feature.isDefault).length,
  1,
  "duplicate persisted defaults must normalize to one model per mode"
);
assert.ok(
  video?.pipelines.some((pipeline) => pipeline.key === "reels-creator"),
  "Video pipeline roles must remain in the unified tree"
);
assert.ok(
  tree.find((tool) => tool.toolKey === "photo")
    ?.pipelines.some((pipeline) => pipeline.key === "storyboard-sheet"),
  "Photo storyboard roles must remain in the Pipeline section"
);
assert.ok(
  variantFromPricingRow(
    "product_photo_seedream_4_per_image",
    "Seedream 4",
    new Map(),
    DEFAULT_BILLING_SETTINGS
  ),
  "code-only pricing defaults must keep extended models visible"
);

async function main(): Promise<void> {
  assert.throws(
    () => requireAdminConfigRows({}, "tools", "tool configs"),
    /Invalid tool configs response/,
    "a malformed successful response must not become an empty tree"
  );
  await assert.rejects(
    readRequiredAdminConfigJson(
      {
        ok: false,
        status: 503,
        json: async () => ({ error: "Tools unavailable." }),
      },
      "tool configs"
    ),
    /Tools unavailable/,
    "a failed required admin response must abort the tree load"
  );
  console.log("admin-config-tree self-check passed");
}

void main();
