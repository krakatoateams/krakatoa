import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAdminConfigTree,
  collectPricingBaselines,
  createPriceSaveTracker,
  isPricingDirty,
  keepPricingDrafts,
  pricingPatchBody,
  refreshedBaselines,
  modelsTabTools,
  priceSummary,
  variantFromPricingRow,
  type AdminCostVariant,
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
    "product_photo_krea_2_large_per_image",
    "Krea 2 Large",
    new Map(),
    DEFAULT_BILLING_SETTINGS
  ),
  "code-only pricing defaults must keep extended models visible"
);

const gptImage = tree
  .find((tool) => tool.toolKey === "photo")
  ?.models.find((model) => model.id === "gpt_image_2");
assert.deepEqual(
  gptImage?.variants.map((variant) => variant.label),
  ["Low", "Medium", "High"],
  "GPT Image 2 quality variants must show in the admin tree"
);

// #484: a refresh keeps unsaved price drafts; clean rows and other fields take the server values.
{
  const variants = tree.flatMap((t) => t.models.flatMap((m) => m.variants));
  assert.ok(variants.length >= 2, "fixture has priced variants");
  const [a, b] = variants;
  const saved = collectPricingBaselines(tree);
  const edited = tree.map((t) => ({
    ...t,
    models: t.models.map((m) => ({
      ...m,
      variants: m.variants.map((v) => (v.pricingKey === a.pricingKey ? { ...v, credits: v.credits + 7 } : v)),
    })),
  }));
  // The server meanwhile changed b's price and a's On flag.
  const fresh = tree.map((t) => ({
    ...t,
    models: t.models.map((m) => ({
      ...m,
      variants: m.variants.map((v) =>
        v.pricingKey === b.pricingKey ? { ...v, credits: v.credits + 3 } : v.pricingKey === a.pricingKey ? { ...v, enabled: !v.enabled } : v,
      ),
    })),
  }));
  const merged = keepPricingDrafts(fresh, edited, saved);
  const find = (key: string) => merged.flatMap((t) => t.models.flatMap((m) => m.variants)).find((v) => v.pricingKey === key)!;
  assert.equal(find(a.pricingKey).credits, a.credits + 7, "dirty row keeps its typed draft");
  assert.equal(find(a.pricingKey).enabled, !a.enabled, "a kept draft still takes the server's other fields");
  assert.equal(find(b.pricingKey).credits, b.credits + 3, "clean row takes the refreshed server price");
  assert.ok(isPricingDirty(find(a.pricingKey), collectPricingBaselines(fresh)), "the kept draft still shows as unsaved");
  assert.equal(keepPricingDrafts(fresh, tree, saved), fresh, "no drafts: the fresh tree is used as is");
  assert.equal(keepPricingDrafts(fresh, [], {}), fresh, "first load has nothing to keep");
}

// #487: a refresh that started before a Save finished must not bring back the old price.
{
  const priced = (tools: typeof tree, key: string) =>
    tools.flatMap((t) => t.models.flatMap((m) => m.variants)).find((v) => v.pricingKey === key)!;
  const withCredits = (tools: typeof tree, key: string, credits: number) =>
    tools.map((t) => ({
      ...t,
      models: t.models.map((m) => ({ ...m, variants: m.variants.map((v) => (v.pricingKey === key ? { ...v, credits } : v)) })),
    }));
  const row = tree.flatMap((t) => t.models.flatMap((m) => m.variants))[0];
  const oldCredits = row.credits;
  const newCredits = oldCredits + 5;
  const tracker = createPriceSaveTracker();

  // 1. A refresh starts; its server read happens before the save, so it will return the old price.
  const seq = tracker.beginRefresh();
  const staleServerTree = tree;
  // 2. The admin saves a new price while that refresh is still loading.
  const live = withCredits(tree, row.pricingKey, newCredits);
  tracker.markSaved(row.pricingKey);
  const saved = { ...collectPricingBaselines(tree), [row.pricingKey]: { providerReferenceUsd: row.providerReferenceUsd, credits: newCredits } };
  // 3. The refresh resolves with the old data.
  const stale = tracker.staleKeys(seq);
  assert.ok(stale.has(row.pricingKey), "the refresh started before the save is stale for that row");
  const merged = keepPricingDrafts(staleServerTree, live, saved, stale);
  const mergedSaved = refreshedBaselines(staleServerTree, saved, stale);
  assert.equal(priced(merged, row.pricingKey).credits, newCredits, "the row keeps the new price");
  assert.equal(mergedSaved[row.pricingKey].credits, newCredits, "its saved baseline stays the new price");
  assert.ok(!isPricingDirty(priced(merged, row.pricingKey), mergedSaved), "and it shows as saved, not unsaved");
  // 4. A later On/Off toggle sends the row's current price, which is the new one.
  const toggled = { ...priced(merged, row.pricingKey), enabled: !row.enabled };
  assert.equal(pricingPatchBody(toggled).credit_amount, newCredits, "the toggle sends the new price, never the old one");
  // Control: the old merge (no stale keys) brought the old price back as clean, which is the bug.
  const buggy = keepPricingDrafts(staleServerTree, live, saved);
  assert.equal(priced(buggy, row.pricingKey).credits, oldCredits, "without the save order the stale price wins");
  // A refresh that starts after the save is trusted again.
  assert.equal(tracker.staleKeys(tracker.beginRefresh()).size, 0, "a later refresh takes the server values");
  // Other rows in the stale refresh still refresh normally.
  const other = tree.flatMap((t) => t.models.flatMap((m) => m.variants)).find((v) => v.pricingKey !== row.pricingKey)!;
  const serverChanged = withCredits(staleServerTree, other.pricingKey, other.credits + 2);
  assert.equal(priced(keepPricingDrafts(serverChanged, live, saved, stale), other.pricingKey).credits, other.credits + 2, "other rows in that refresh still take the server values");
  // A draft typed after the save survives the stale refresh and stays unsaved.
  const drafted = withCredits(live, row.pricingKey, newCredits + 1);
  const keptDraft = priced(keepPricingDrafts(staleServerTree, drafted, saved, stale), row.pricingKey);
  assert.ok(keptDraft.credits === newCredits + 1 && isPricingDirty(keptDraft, refreshedBaselines(staleServerTree, saved, stale)), "a newer draft is kept and still unsaved");
}

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
  modelsTabSelfCheck();
  console.log("admin-config-tree self-check passed");
}

/**
 * #466: Config (feature toggles) and Models (models + prices) tabs. Pure helpers, plus a wiring pin on the
 * moved UI so a save path, dialog or section that gets disconnected fails CI.
 */
function modelsTabSelfCheck(): void {
  const v = (pricingKey: string, credits: number, enabled = true, costUnit: AdminCostVariant["costUnit"] = "per_image"): AdminCostVariant => ({
    pricingKey,
    label: pricingKey,
    credits,
    providerReferenceUsd: 0.1,
    costUnit,
    enabled,
  });
  assert.equal(priceSummary([v("a", 10)], {}), "10 credits per image");
  assert.equal(priceSummary([v("a", 1, true, "per_run")], {}), "1 credit per run");
  assert.equal(priceSummary([v("a", 8), v("b", 14), v("c", 10)], {}), "8–14 credits per image");
  assert.equal(priceSummary([v("a", 8), v("b", 99, false)], {}), "8 credits per image", "variants that are off do not widen the range");
  assert.equal(priceSummary([v("a", 8, false)], {}), "8 credits per image", "all off still shows a price");
  assert.equal(priceSummary([v("a", 9)], { a: { credits: 7 } }), "7 credits per image", "the row shows the saved price, not a draft");
  assert.equal(priceSummary([v("a", 5, true, "per_second"), v("b", 3)], {}), "3–5 credits", "mixed units drop the unit");
  assert.equal(priceSummary([], {}), null);

  const listed = modelsTabTools(tree).map((t) => t.toolKey);
  for (const t of tree) {
    const hasModels = t.models.length > 0 || t.pipelines.length > 0;
    assert.equal(listed.includes(t.toolKey), hasModels, `${t.toolKey}: in the Models tab iff it has models or a pipeline`);
  }

  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const admin = join(root, "app/(app)/admin");
  const src = readFileSync(join(admin, "(catalog)/AdminCatalog.tsx"), "utf8");
  const body = (name: string) => {
    const start = src.search(new RegExp(`\\nexport function ${name}\\(|\\nfunction ${name}\\(`));
    assert.ok(start >= 0, `${name} exists`);
    const next = src.slice(start + 1).search(/\n(export )?function |\nconst [A-Z_]+ |\ntype |\nclass /);
    return next < 0 ? src.slice(start) : src.slice(start, start + 1 + next);
  };
  const renders = (parent: string, children: string[]) => {
    const b = body(parent);
    for (const c of children) assert.ok(b.includes(`<${c}`), `${parent} still renders ${c}`);
  };
  renders("AdminConfigView", ["ToolRow", "PlatformAvailabilitySection"]);
  renders("AdminModelsView", ["ToolModels"]);
  renders("ToolModels", ["ModelSection", "PipelineSection", "RemoveModelDialog", "AddModelDialog", "ChipDropdown", "OverrideDefaultDialog"]);
  renders("ModelSection", ["PhotoProviderSwitch", "ModesTable", "VariantTable"]);
  // #476: the picker only restores removed models, so it says "Restore model", never "Add model".
  const dialogs = readFileSync(join(admin, "(catalog)/ToolModelDialogs.tsx"), "utf8");
  for (const copy of ["Restore a model to ${toolLabel}", 'confirmLabel="Restore model"', "No removed models to restore.", "No price yet, so it can't be restored."]) {
    assert.ok(dialogs.includes(copy), `Restore dialog copy: ${copy}`);
  }
  assert.ok(src.includes("Restore model") && !/Add model|Add a model/.test(src + dialogs), "no 'Add model' copy left in the Models tab");
  renders("PipelineSection", ["PipelineRolesTable", "VariantTable"]);
  const toolRow = body("ToolRow");
  for (const field of ["tool.enabled", "tool.visibleInSidebar", "tool.comingSoon"]) {
    assert.ok(toolRow.includes(field), `Config row keeps ${field}`);
  }
  assert.equal((toolRow.match(/onCommitTool\(/g) ?? []).length, 3, "all three Config toggles still autosave");
  // Every save endpoint the old single page called is still called.
  for (const url of [
    "/api/admin/config/tools/${toolKey}",
    "/api/admin/config/pricing/${pricingKey}",
    "/api/admin/config/feature-models/${featureModelId}",
    "/api/admin/config/model-catalog/${live.catalogConfigId}",
    "/archive",
    "/restore",
    "/api/admin/config/models/${modelConfigId}",
    "/api/admin/config/photo-provider",
    "/api/admin/config/provider-costs",
    "/api/platform-availability",
    "TOOL_CONFIG_UPDATED_EVENT",
  ]) {
    assert.ok(src.includes(url), `still wired: ${url}`);
  }
  assert.ok(!src.includes("Replicate $"), "the cost column is labelled as the highest cost, not Replicate");
  // #484: the optional costs / packs reads time out to "cost not set" / a dash; the tooltip names bonus credits.
  assert.ok(src.includes("signal: AbortSignal.timeout(OPTIONAL_READ_TIMEOUT_MS)") && src.includes("OPTIONAL_READ_TIMEOUT_MS = 8_000"), "optional reads have an 8 s timeout");
  assert.ok(src.includes("lowest pack price per credit, bonus credits included"), "margin tooltip says bonus credits are included");
  // #487: refreshes are ordered against saves, and Save and the toggle send one shared PATCH body.
  assert.ok(src.includes("const refreshSeq = priceSavesRef.current.beginRefresh();") && src.includes("priceSavesRef.current.staleKeys(refreshSeq)"), "load discards data older than a row's last save");
  assert.ok(
    src.includes("keepPricingDrafts(tree, toolsRef.current, savedPricingRef.current, stale)") &&
      src.includes("refreshedBaselines(tree, savedPricingRef.current, stale)") &&
      !src.includes("setSavedPricing(collectPricingBaselines("),
    "load merges with the stale keys for both the rows and their saved baselines",
  );
  assert.equal(src.split("setSavedPricing(").length - 1, src.split("savedPricingRef.current = ").length - 1, "every saved-baseline update also updates the ref");
  assert.ok(!src.includes("savedPricingRef.current = savedPricing;"), "the ref is never copied back from state on render");
  assert.ok(/patchApi\(`\/api\/admin\/config\/pricing\/\$\{pricingKey\}`, pricingPatchBody\(live\)\);\s*priceSavesRef\.current\.markSaved\(pricingKey\);/.test(src), "a successful Save is recorded");
  assert.equal(src.split("pricingPatchBody(live)").length - 1, 2, "Save and the On/Off toggle both send the row's current price");
  assert.ok(!src.includes("credit_amount: Math.round(live.credits)"), "no second hand-built pricing body");
  // #484: browser Back asks before dropping drafts; Save stays focusable after it saves.
  assert.ok(src.includes('window.addEventListener("popstate", onPopState)') && src.includes("BACK_GUARD_KEY"), "unsaved drafts guard browser Back");
  assert.ok(src.includes("aria-disabled={!dirty || saving}") && !/(?<!aria-)disabled=\{!dirty \|\| saving\}/.test(src), "Save never disables itself while focused");
  for (const route of ["(catalog)/layout.tsx", "(catalog)/config-v2/page.tsx", "(catalog)/models/page.tsx"]) {
    assert.ok(existsSync(join(admin, route)), `route file ${route} exists`);
  }
  assert.ok(!existsSync(join(admin, "config-v2")), "no second config-v2 route outside the shared layout");
  assert.ok(readFileSync(join(admin, "config/page.tsx"), "utf8").includes('redirect("/admin/config-v2")'), "old /admin/config still redirects");
  const nav = readFileSync(join(admin, "AdminNav.tsx"), "utf8");
  assert.ok(nav.includes('href: "/admin/config-v2"') && nav.includes('href: "/admin/models"'), "admin nav has Config and Models");
}

void main();
