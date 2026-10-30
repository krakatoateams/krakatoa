import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { defaultModelCatalogRows } from "./model-catalog-configs";
import { DEFAULT_PRODUCT_PHOTO_TIER } from "./product-photo";
import { defaultTierForFeature, eligibleTiersForFeature, PHOTO_FEATURE_KEYS } from "./creation-features";
import { modelPricingKeys } from "./model-pricing-keys";
import { classifyAdminError, NotAdminError } from "./admin-auth-pure";
import {
  applyCatalogToggle,
  applyFeatureModelChange,
  type CatalogRowFull,
  type FeatureRowFull,
  type ModelAuditEntry,
  type ModelChangeStore,
} from "./model-config-change";

// In-memory store; the guard, enablement resolver, catalog and pricing keys are the real code.
const all = defaultModelCatalogRows();
let clock = 0;
const stamp = () => `2026-01-01T00:00:${String(++clock).padStart(2, "0")}Z`;

function makeStore(opts: { falConfigured?: boolean; auditFails?: boolean; pricingMissing?: string[] } = {}) {
  const catalog: CatalogRowFull[] = all.map((d, i) => ({
    id: `c${i}`,
    tool_key: d.toolKey,
    model_id: d.modelId,
    enabled: d.enabled,
    updated_at: stamp(),
  }));
  const features: FeatureRowFull[] = [];
  const audits: ModelAuditEntry[] = [];
  let writes = 0;
  const store: ModelChangeStore = {
    listCatalog: async () => catalog.map((r) => ({ ...r })),
    listFeatureRows: async () => features.map((r) => ({ ...r })),
    listPricing: async () =>
      all
        .flatMap((d) => modelPricingKeys(d.toolKey, d.modelId))
        .filter((k) => !(opts.pricingMissing ?? []).includes(k))
        .map((k) => ({ pricing_key: k, enabled: true, is_deprecated: false, credit_amount: 5 })),
    listModelConfigs: async () => [],
    providerConfigured: () => opts.falConfigured ?? true,
    casCatalog: async (id, enabled, expected) => {
      const r = catalog.find((x) => x.id === id);
      if (!r || r.updated_at !== expected) return null;
      writes++;
      Object.assign(r, { enabled, updated_at: stamp() });
      return { ...r };
    },
    casFeature: async (id, patch, expected) => {
      const r = features.find((x) => x.id === id);
      if (!r || r.updated_at !== expected) return null;
      writes++;
      if (patch.is_default) for (const o of features) if (o.feature_key === r.feature_key && o.id !== id) o.is_default = false;
      Object.assign(r, patch, { updated_at: stamp() });
      return { ...r };
    },
    audit: async (e) => {
      // A failing audit insert is swallowed by the real recorder; model that here.
      if (!opts.auditFails) audits.push(e);
    },
  };
  return { store, catalog, features, audits, writes: () => writes };
}

const actorProfileId = "admin-1";
const toggle = (s: ModelChangeStore, id: string, enabled: boolean, expectedUpdatedAt: unknown) =>
  applyCatalogToggle(s, { id, enabled, expectedUpdatedAt, actorProfileId });

const photo = all.filter((d) => d.toolKey === "photo").map((d) => d.modelId);
const defaults = new Set(PHOTO_FEATURE_KEYS.map((k) => defaultTierForFeature(k) as string));
const plain = photo.find((id) => !defaults.has(id))!;

async function main() {
  // Happy path: disable then enable a non-default model; one audit row each with before/after.
  {
    const t = makeStore();
    const row = t.catalog.find((r) => r.model_id === plain)!;
    const off = await toggle(t.store, row.id, false, row.updated_at);
    assert.equal(off.status, 200);
    assert.equal(row.enabled, false);
    assert.equal(t.audits.length, 1);
    assert.deepEqual(
      { a: t.audits[0].action, k: t.audits[0].configKey, b: t.audits[0].before, f: t.audits[0].after, who: t.audits[0].actorProfileId },
      { a: "model_disable", k: plain, b: { enabled: true }, f: { enabled: false }, who: actorProfileId }
    );
    const on = await toggle(t.store, row.id, true, row.updated_at);
    assert.equal(on.status, 200);
    assert.equal(row.enabled, true);
    assert.equal(t.audits[1].action, "model_enable");
  }

  // Missing expectedUpdatedAt -> 400, no write.
  {
    const t = makeStore();
    assert.equal((await toggle(t.store, t.catalog[0].id, false, undefined)).status, 400);
    assert.equal(t.writes(), 0);
  }

  // Unknown id -> 404; orphan model row -> 409 UNKNOWN_MODEL.
  {
    const t = makeStore();
    assert.equal((await toggle(t.store, "nope", false, "x")).status, 404);
    t.catalog.push({ id: "orphan", tool_key: "photo", model_id: "removed-model", enabled: true, updated_at: stamp() });
    const r = await toggle(t.store, "orphan", false, t.catalog.at(-1)!.updated_at);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "UNKNOWN_MODEL");
  }

  // Default needs a replacement chosen first; then retry succeeds.
  {
    const t = makeStore();
    const def = t.catalog.find((r) => r.model_id === DEFAULT_PRODUCT_PHOTO_TIER)!;
    const blocked = await toggle(t.store, def.id, false, def.updated_at);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, "IS_DEFAULT");
    assert.equal((blocked.body.modelCatalog as CatalogRowFull).id, def.id, "rejection carries the current row for UI rollback");
    assert.ok((blocked.body.reasons as string[]).some((r) => r.includes("Pick another default first")));
    assert.equal(t.writes(), 0);
    assert.equal(t.audits.length, 0);

    // The admin picks another default in every feature it leads, via the feature-model endpoint.
    const led = PHOTO_FEATURE_KEYS.filter((k) => defaultTierForFeature(k) === DEFAULT_PRODUCT_PHOTO_TIER);
    assert.ok(led.length > 0);
    for (const feature of led) {
      const other = eligibleTiersForFeature(feature).find((id) => id !== DEFAULT_PRODUCT_PHOTO_TIER)!;
      assert.ok(other, `fixture: ${feature} has a second eligible tier`);
      const fOther: FeatureRowFull = {
        id: `f-${feature}-${other}`, tool_key: "photo", feature_key: feature, model_tier: other,
        enabled: true, is_default: false, updated_at: stamp(),
      };
      t.features.push(fOther);
      const set = await applyFeatureModelChange(t.store, {
        id: fOther.id, patch: { is_default: true }, expectedUpdatedAt: fOther.updated_at, actorProfileId,
      });
      assert.equal(set.status, 200, JSON.stringify(set.body));
      assert.equal(t.audits.at(-1)!.action, "feature_model_update");
      assert.equal(t.audits.at(-1)!.configKey, `${feature}:${other}`);
    }
    const retry = await toggle(t.store, def.id, false, def.updated_at);
    assert.equal(retry.status, 200, JSON.stringify(retry.body));
    assert.equal(def.enabled, false);
  }

  // Last enabled model of a family -> LAST_ENABLED_MODEL.
  {
    const t = makeStore();
    for (const r of t.catalog) if (r.tool_key === "photo" && r.model_id !== plain) r.enabled = false;
    const row = t.catalog.find((r) => r.model_id === plain)!;
    const r = await toggle(t.store, row.id, false, row.updated_at);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "LAST_ENABLED_MODEL");
  }

  // Last Reels Creator engine -> REELS_ENGINE_LAST (veo off, seedance2_fast is the last engine).
  {
    const t = makeStore();
    t.catalog.find((r) => r.model_id === "veo31_lite")!.enabled = false;
    const row = t.catalog.find((r) => r.model_id === "seedance2_fast")!;
    const r = await toggle(t.store, row.id, false, row.updated_at);
    assert.equal(r.status, 409);
    assert.ok((r.body.reasons as string[]).some((x) => x.includes("last offered Reels Creator engine")));
    assert.equal((r.body.code as string) === "REELS_ENGINE_LAST" || r.body.code === "LAST_ENABLED_MODEL" || r.body.code === "IS_DEFAULT", true);
  }

  // Enabling needs pricing ready.
  {
    const key = modelPricingKeys("photo", plain)[0];
    const t = makeStore({ pricingMissing: [key] });
    const row = t.catalog.find((r) => r.model_id === plain)!;
    row.enabled = false;
    const r = await toggle(t.store, row.id, true, row.updated_at);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "PRICING_NOT_READY");
    assert.equal(row.enabled, false);
    assert.equal(t.writes(), 0);
  }

  // Enabling needs a configured provider (Fal-bound tier without FAL_KEY is exercised via the guard core self-check;
  // here a Replicate-bound tier with an unconfigured provider is enough to prove the server-side wiring).
  {
    const t = makeStore({ falConfigured: false });
    const row = t.catalog.find((r) => r.model_id === plain)!;
    row.enabled = false;
    const r = await toggle(t.store, row.id, true, row.updated_at);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, "PROVIDER_NOT_CONFIGURED");
  }

  // CAS: stale expectedUpdatedAt -> 409 STALE_MODEL_CONFIG with the current row; nothing written.
  {
    const t = makeStore();
    const row = t.catalog.find((r) => r.model_id === plain)!;
    const seen = row.updated_at;
    assert.equal((await toggle(t.store, row.id, false, seen)).status, 200);
    const stale = await toggle(t.store, row.id, true, seen);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "STALE_MODEL_CONFIG");
    assert.match((stale.body.reasons as string[])[0], /Someone else changed this model/);
    assert.equal((stale.body.modelCatalog as CatalogRowFull).enabled, false);
    assert.equal(row.enabled, false);
    assert.equal(t.audits.length, 1);
  }

  // Double submit: same request twice -> second is a 200 no-op (even though its token is now stale); one write, one audit.
  {
    const t = makeStore();
    const row = t.catalog.find((r) => r.model_id === plain)!;
    const seen = row.updated_at;
    assert.equal((await toggle(t.store, row.id, false, seen)).body.noop, false);
    const again = await toggle(t.store, row.id, false, seen);
    assert.equal(again.status, 200);
    assert.equal(again.body.noop, true);
    assert.equal(t.writes(), 1);
    assert.equal(t.audits.length, 1);
  }

  // Audit failure never fails the change.
  {
    const t = makeStore({ auditFails: true });
    const row = t.catalog.find((r) => r.model_id === plain)!;
    assert.equal((await toggle(t.store, row.id, false, row.updated_at)).status, 200);
    assert.equal(row.enabled, false);
  }

  // Feature rows: last enabled model of a feature, unreplaced default, stale token, no-op.
  {
    const t = makeStore();
    const tiers = eligibleTiersForFeature("image");
    const mk = (tier: string, enabled: boolean, is_default: boolean): FeatureRowFull => ({
      id: `f-${tier}`, tool_key: "photo", feature_key: "image", model_tier: tier, enabled, is_default, updated_at: stamp(),
    });
    // Every other photo tier off in the catalog, so only tiers[0] is offered for the feature.
    for (const r of t.catalog) if (r.tool_key === "photo" && r.model_id !== tiers[0]) r.enabled = false;
    const only = mk(tiers[0], true, true);
    t.features.push(only);
    const apply = (id: string, patch: { enabled?: boolean; is_default?: boolean }, exp: string) =>
      applyFeatureModelChange(t.store, { id, patch, expectedUpdatedAt: exp, actorProfileId });
    const last = await apply(only.id, { enabled: false }, only.updated_at);
    assert.equal(last.status, 409);
    assert.equal(last.body.code, "LAST_ENABLED_MODEL");
    assert.equal((await apply(only.id, { enabled: true }, "stale")).body.noop, true);
    assert.equal((await applyFeatureModelChange(t.store, { id: only.id, patch: { enabled: true }, expectedUpdatedAt: undefined, actorProfileId })).status, 400);
    assert.equal(t.writes(), 0);
  }

  // Authorization: routes are admin-gated and a non-admin maps to 403.
  assert.equal(classifyAdminError(new NotAdminError()).status, 403);
  for (const p of ["app/api/admin/config/model-catalog/[id]/route.ts", "app/api/admin/config/feature-models/[id]/route.ts"]) {
    assert.match(readFileSync(p, "utf8"), /withAdmin\(/, p);
  }

  console.log("model-config-change self-check passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
