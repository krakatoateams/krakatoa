import assert from "node:assert/strict";
import { defaultModelCatalogRows } from "./model-catalog-configs";
import { PRODUCT_PHOTO_TIERS, DEFAULT_PRODUCT_PHOTO_TIER } from "./product-photo";
import {
  defaultTierForFeature,
  eligibleTiersForFeature,
  PHOTO_FEATURE_KEYS,
} from "./creation-features";
import {
  defaultModelForComposer,
  eligibleModelsForComposer,
  VIDEO_COMPOSER_KEYS,
} from "./video-composer-features";
import { FAL_PHOTO_MODELS } from "./ai-providers/fal-photo-catalog";
import { resolveFeatureEnablement } from "./feature-enablement";
import { modelPricingKeys, videoPricingContexts } from "./model-pricing-keys";
import { photoTierPricingKey } from "./product-photo";
import { VIDEO_MODELS } from "./video-models";
import { MOTION_CONTROL_MODELS } from "./motion-control-models";
import { REELS_ENGINE_CATALOG_MODEL_ID, reelsPricingKey, SEEDANCE_RESOLUTIONS, VEO_RESOLUTIONS } from "./reels-models";
import {
  checkModelCatalogChange,
  type GuardCatalogRow,
  type GuardFeatureRow,
  type GuardPricingRow,
  type ModelCatalogGuardInput,
} from "./model-catalog-guard";
import { buildModelRegistry, type RegistryCatalogRow } from "./model-registry";

// Only DB rows are fixtures; the catalog, eligibility, defaults and pricing keys are the real code.
const all = defaultModelCatalogRows();
const ids = (tool: string) => all.filter((d) => d.toolKey === tool).map((d) => d.modelId);
const readyPricing: GuardPricingRow[] = all.flatMap((d) =>
  modelPricingKeys(d.toolKey, d.modelId).map((k) => ({
    pricing_key: k,
    enabled: true,
    is_deprecated: false,
    credit_amount: 5,
  }))
);
const off = (tool: string, modelIds: string[]): GuardCatalogRow[] =>
  modelIds.map((m) => ({ tool_key: tool, model_id: m, enabled: false }));

const base = (over: Partial<ModelCatalogGuardInput>): ModelCatalogGuardInput => ({
  toolKey: "photo",
  modelId: DEFAULT_PRODUCT_PHOTO_TIER,
  change: "disable",
  catalogRows: [],
  featureRows: [],
  pricingRows: readyPricing,
  provider: { id: "replicate", configured: true },
  ...over,
});
const fail = (r: ReturnType<typeof checkModelCatalogChange>) => {
  assert.equal(r.ok, false);
  return r as Extract<typeof r, { ok: false }>;
};

// A photo tier that is nobody's default.
const defaults = new Set(PHOTO_FEATURE_KEYS.map((k) => defaultTierForFeature(k)));
const plain = ids("photo").find((id) => !defaults.has(id as never))!;
assert.ok(plain, "fixture: a non-default photo tier exists");

// Unknown model.
assert.equal(fail(checkModelCatalogChange(base({ modelId: "nope" }))).code, "UNKNOWN_MODEL");
assert.equal(fail(checkModelCatalogChange(base({ toolKey: "ig", modelId: plain }))).code, "UNKNOWN_MODEL");

// Normal disable / enable pass; same state is a no-op.
assert.deepEqual(checkModelCatalogChange(base({ modelId: plain })), { ok: true, noop: false, warnings: [] });
assert.deepEqual(checkModelCatalogChange(base({ modelId: plain, change: "enable" })), {
  ok: true,
  noop: true,
  warnings: [],
});
const plainOff = off("photo", [plain]);
assert.equal(checkModelCatalogChange(base({ modelId: plain, catalogRows: plainOff })).ok, true);
assert.equal(
  (checkModelCatalogChange(base({ modelId: plain, catalogRows: plainOff })) as { noop: boolean }).noop,
  true
);
assert.deepEqual(
  checkModelCatalogChange(base({ modelId: plain, change: "enable", catalogRows: plainOff })),
  { ok: true, noop: false, warnings: [] }
);

// Code default: rejected with composer names.
const codeDefault = fail(checkModelCatalogChange(base({})));
assert.ok(codeDefault.codes.includes("IS_DEFAULT"));
assert.ok(codeDefault.reasons.some((r) => r.includes("Image generation")));

// DB-flagged default: rejected for the composer that flag names, even though it is not the code default.
const dbDefault: GuardFeatureRow[] = [
  { tool_key: "photo", feature_key: "image", model_tier: plain, enabled: true, is_default: true },
];
const dbDef = fail(checkModelCatalogChange(base({ modelId: plain, featureRows: dbDefault })));
assert.equal(dbDef.code, "IS_DEFAULT");
assert.ok(dbDef.reasons.some((r) => r.includes("Image generation")));
// A DB default row that is disabled does not make the model "the default" (runtime ignores it).
assert.equal(
  checkModelCatalogChange(
    base({ modelId: plain, featureRows: [{ ...dbDefault[0], enabled: false }] })
  ).ok,
  true
);

// Last enabled: family and feature level.
const onlyPlain = off("photo", ids("photo").filter((id) => id !== plain));
const lastFamily = fail(checkModelCatalogChange(base({ modelId: plain, catalogRows: onlyPlain })));
assert.ok(lastFamily.codes.includes("LAST_ENABLED_MODEL"));
const refTiers = eligibleTiersForFeature("product");
const lastRef = refTiers[0];
const othersRef = off("photo", refTiers.slice(1));
const lastFeature = fail(checkModelCatalogChange(base({ modelId: lastRef, catalogRows: othersRef })));
assert.ok(lastFeature.codes.includes("LAST_ENABLED_MODEL"));
assert.ok(lastFeature.reasons.some((r) => r.includes("Product try-on")));

// Reels engine: seedance2_fast while it is the only offered Reels Creator engine.
const noVeo = off("reels", ["veo31_lite"]);
const engine = fail(
  checkModelCatalogChange(base({ toolKey: "reels", modelId: "seedance2_fast", catalogRows: noVeo }))
);
assert.ok(engine.codes.includes("REELS_ENGINE_LAST"));
// With both engines offered, REELS_ENGINE_LAST does not fire.
const bothEngines = checkModelCatalogChange(base({ toolKey: "reels", modelId: "seedance2_fast" }));
assert.ok(bothEngines.ok || !bothEngines.codes.includes("REELS_ENGINE_LAST"));

// Pricing: enabling needs every key ready.
const target = plain;
const keys = modelPricingKeys("photo", target);
assert.ok(keys.length > 0);
const enable = (rows: GuardPricingRow[], provider = { id: "replicate", configured: true }) =>
  checkModelCatalogChange(
    base({ modelId: target, change: "enable", catalogRows: plainOff, pricingRows: rows, provider })
  );
assert.equal(enable(readyPricing).ok, true);
const without = readyPricing.filter((r) => r.pricing_key !== keys[0]);
const missing = fail(enable(without));
assert.equal(missing.code, "PRICING_NOT_READY");
assert.ok(missing.reasons[0].includes(keys[0]));
for (const patch of [{ enabled: false }, { is_deprecated: true }, { credit_amount: -1 }, { credit_amount: 1.5 }]) {
  const rows = readyPricing.map((r) => (r.pricing_key === keys[0] ? { ...r, ...patch } : r));
  assert.equal(fail(enable(rows)).code, "PRICING_NOT_READY", JSON.stringify(patch));
}

// Reels Creator engines bill reelsPricingKey(): their keys must be required, not only the video model's own.
for (const [engine, resolutions] of [["veo", VEO_RESOLUTIONS], ["seedance", SEEDANCE_RESOLUTIONS]] as const) {
  const modelId = REELS_ENGINE_CATALOG_MODEL_ID[engine];
  const engineKeys = resolutions.map((r) => reelsPricingKey(engine, r));
  const required = modelPricingKeys("reels", modelId);
  for (const k of engineKeys) assert.ok(required.includes(k), `${modelId} requires ${k}`);
  assert.equal(new Set(required).size, required.length, "deduped");
  const offModel = off("reels", [modelId]);
  // Realistic fixture: every other pricing row exists, only the engine keys are absent.
  const rows = readyPricing.filter((r) => !engineKeys.includes(r.pricing_key));
  const res = fail(
    checkModelCatalogChange(
      base({ toolKey: "reels", modelId, change: "enable", catalogRows: offModel, pricingRows: rows })
    )
  );
  assert.equal(res.code, "PRICING_NOT_READY");
  assert.ok(engineKeys.every((k) => res.reasons[0].includes(k)), res.reasons[0]);
  assert.equal(
    checkModelCatalogChange(
      base({ toolKey: "reels", modelId, change: "enable", catalogRows: offModel, pricingRows: readyPricing })
    ).ok,
    true
  );
}

// Every key a generation route can bill is covered by modelPricingKeys (photo, video, storyboard, motion control).
for (const t of PRODUCT_PHOTO_TIERS) {
  const covered = new Set(modelPricingKeys("photo", t.id));
  for (const res of [null, ...t.resolutions.map((r) => r.id)])
    for (const q of [null, ...(t.qualities ?? []).map((x) => x.id)]) {
      const key = photoTierPricingKey(t, res as never, q as never);
      assert.ok(covered.has(key), `photo ${t.id}: billed key ${key} is covered`);
    }
}
for (const m of VIDEO_MODELS) {
  const covered = new Set(modelPricingKeys("reels", m.id));
  for (const ctx of videoPricingContexts(m)) assert.ok(covered.has(m.pricingKey(ctx)), `video ${m.id}`);
  // generate-storyboard-video bills { resolution, hasReferenceVideo: false } with the default audio flag.
  for (const resolution of m.resolutions.length ? m.resolutions : [m.defaultResolution])
    assert.ok(covered.has(m.pricingKey({ resolution, hasReferenceVideo: false })), `storyboard ${m.id}`);
}
for (const m of MOTION_CONTROL_MODELS) {
  const covered = new Set(modelPricingKeys("reels", m.id));
  for (const mode of m.modes) assert.ok(covered.has(m.pricingKey(mode)), `motion ${m.id}`);
}

// Provider: a Fal-bound tier without FAL_KEY.
assert.equal(fail(enable(readyPricing, { id: "fal", configured: false })).code, "PROVIDER_NOT_CONFIGURED");
assert.equal(enable(readyPricing, { id: "fal", configured: true }).ok, true);

// Refactor equivalence: resolveFeatureEnablement == the pre-refactor inline logic.
type Row = { enabled: boolean; is_default: boolean };
function legacy(eligible: string[], catalog: Set<string>, rows: Map<string, Row>, codeDefault: string) {
  const enabledTiers = eligible.filter((t) => {
    if (!catalog.has(t)) return false;
    const r = rows.get(t);
    return r ? r.enabled : true;
  });
  const dbDef = eligible.find((t) => rows.get(t)?.is_default && enabledTiers.includes(t));
  return {
    enabledTiers,
    defaultTier: dbDef ?? (enabledTiers.includes(codeDefault) ? codeDefault : enabledTiers[0] ?? codeDefault),
  };
}
const units = [
  ...PHOTO_FEATURE_KEYS.map((k) => ({ eligible: eligibleTiersForFeature(k) as string[], codeDefault: defaultTierForFeature(k) as string, tool: "photo" })),
  ...VIDEO_COMPOSER_KEYS.map((k) => ({ eligible: eligibleModelsForComposer(k), codeDefault: defaultModelForComposer(k), tool: "reels" })),
];
for (const u of units) {
  const last = u.eligible[u.eligible.length - 1];
  const scenarios: [string, Set<string>, Map<string, Row>][] = [
    ["no rows", new Set(ids(u.tool)), new Map()],
    ["all disabled", new Set(), new Map(u.eligible.map((t) => [t, { enabled: false, is_default: false }]))],
    ["catalog off", new Set(), new Map()],
    ["db default set", new Set(ids(u.tool)), new Map([[last, { enabled: true, is_default: true }]])],
    ["db default disabled", new Set(ids(u.tool)), new Map([[last, { enabled: false, is_default: true }]])],
  ];
  for (const [name, catalog, rows] of scenarios) {
    assert.deepEqual(
      resolveFeatureEnablement({ eligible: u.eligible, catalogEnabled: catalog, rowFor: (t) => rows.get(t), codeDefault: u.codeDefault }),
      legacy(u.eligible, catalog, rows, u.codeDefault),
      `${u.tool} ${name}`
    );
  }
}

// Registry view: payload shape, flags only, Fal binding reported as not configured.
const falEntry = Object.entries(FAL_PHOTO_MODELS)[0];
const falTier = PRODUCT_PHOTO_TIERS.find((t) => t.modelRole === falEntry[1].configKey)!;
const catalogRows: RegistryCatalogRow[] = [
  { id: "c1", tool_key: "photo", model_id: plain, enabled: false, updated_at: "2026-01-01T00:00:00Z" },
];
const registry = buildModelRegistry({
  catalogRows,
  featureRows: [],
  pricingRows: readyPricing.filter((r) => r.pricing_key !== modelPricingKeys("photo", falTier.id)[0]),
  modelConfigs: [{ tool_key: "photo", config_key: falTier.modelRole, provider: "fal", model: falEntry[0], enabled: true }],
  providerConfigured: (p) => p !== "fal",
});
assert.equal(registry.length, all.length);
const rPlain = registry.find((m) => m.modelId === plain)!;
assert.equal(rPlain.enabled, false);
assert.equal(rPlain.catalogConfigId, "c1");
assert.equal(rPlain.availableToAdd, true);
const rFal = registry.find((m) => m.modelId === falTier.id)!;
assert.deepEqual(rFal.provider, { id: "fal", label: "fal.ai", configured: false });
assert.equal(rFal.pricing.ready, false);
assert.ok(rFal.pricing.keys.some((k) => !k.ready));
const rDefault = registry.find((m) => m.modelId === DEFAULT_PRODUCT_PHOTO_TIER)!;
assert.ok(rDefault.defaultIn.some((d) => d.label === "Image generation"));
assert.equal(rDefault.isCodeDefault, true);
assert.equal(rDefault.disableCheck.code, "IS_DEFAULT");
assert.equal(registry.find((m) => m.modelId === "seedance2_fast")!.reelsEngine, "seedance");
assert.doesNotMatch(JSON.stringify(registry), /FAL_KEY|secret|apiKey|Bearer/i);

console.log("model-catalog-guard self-check passed");
