import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isArchiveColumnMissing, catalogRowsFrom, defaultModelCatalogRows, enabledIdsFromRows } from "./model-catalog-configs";
import { PRODUCT_PHOTO_TIERS } from "./product-photo";
import { buildModelRegistry } from "./model-registry";
import { DEFAULT_PRODUCT_PHOTO_TIER } from "./product-photo";
import { defaultTierForFeature, eligibleTiersForFeature, PHOTO_FEATURE_KEYS } from "./creation-features";
import { modelPricingKeys } from "./model-pricing-keys";
import { classifyAdminError, NotAdminError } from "./admin-auth-pure";
import {
  applyCatalogArchive,
  applyCatalogToggle,
  applyFeatureModelChange,
  applyFeatureModelReset,
  type CatalogRowFull,
  type FeatureRowFull,
  type ModelAuditEntry,
  type ModelChangeStore,
} from "./model-config-change";

// In-memory store; the guard, enablement resolver, catalog and pricing keys are the real code.
const all = defaultModelCatalogRows();
let clock = 0;
const stamp = () => `2026-01-01T00:00:${String(++clock).padStart(2, "0")}Z`;

function makeStore(opts: { archiveAvailable?: boolean; inFlight?: number | null; falConfigured?: boolean; auditFails?: boolean; pricingMissing?: string[]; everOffered?: boolean | null } = {}) {
  const catalog: CatalogRowFull[] = defaultModelCatalogRows().map((d, i) => ({
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
    archiveAvailable: async () => opts.archiveAvailable ?? true,
    casArchive: async (id, archive, expected, actor) => {
      const r = catalog.find((x) => x.id === id);
      if (!r || r.updated_at !== expected) return null;
      writes++;
      Object.assign(r, archive ? { enabled: false, archived_at: "2026-02-01T00:00:00Z", archived_by_profile_id: actor } : { archived_at: null }, { updated_at: stamp() });
      return { ...r };
    },
    inFlightJobs: async () => opts.inFlight ?? null,
    everOffered: async () => (opts.everOffered === undefined ? false : opts.everOffered),
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
    assert.ok((r.body.codes as string[]).includes("REELS_ENGINE_LAST"));
    // seedance2_fast is also the Reels default, and IS_DEFAULT outranks REELS_ENGINE_LAST.
    assert.equal(r.body.code, "IS_DEFAULT");
    assert.deepEqual(r.body.codes, ["IS_DEFAULT", "REELS_ENGINE_LAST"]);
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

  // Phase 3: ship dark + add from catalog. Flag the REAL plain tier dark for this block, then restore it.
  {
    const snapshot = defaultModelCatalogRows().map((d) => `${d.toolKey}:${d.modelId}:${d.enabled}`);
    assert.ok(snapshot.every((s) => s.endsWith(":true")), "existing models all stay offered by default");
    const tier = PRODUCT_PHOTO_TIERS.find((x) => x.id === plain)!;
    tier.offeredByDefault = false;
    try {
      const dark = defaultModelCatalogRows().filter((d) => !d.enabled);
      assert.deepEqual(dark.map((d) => d.modelId), [plain]);
      assert.equal(catalogRowsFrom([{ id: "x", offeredByDefault: false }], [], []).at(0)!.enabled, false);
      // Missing-row path (no DB row) and materialized path both keep it hidden; every other model stays offered.
      assert.equal(enabledIdsFromRows("photo", []).has(plain), false);
      assert.equal(enabledIdsFromRows("photo", [{ tool_key: "photo", model_id: plain, enabled: false }]).has(plain), false);
      assert.equal(enabledIdsFromRows("photo", []).size, photo.length - 1);
      assert.equal(enabledIdsFromRows("photo", [{ tool_key: "photo", model_id: plain, enabled: true }]).has(plain), true);

      // Pricing not ready -> rejected; provider not configured -> rejected; unknown model never reachable.
      const key = modelPricingKeys("photo", plain)[0];
      const noPrice = makeStore({ pricingMissing: [key] });
      const r0 = noPrice.catalog.find((r) => r.model_id === plain)!;
      assert.equal(r0.enabled, false);
      const blocked = await toggle(noPrice.store, r0.id, true, r0.updated_at);
      assert.equal(blocked.body.code, "PRICING_NOT_READY");
      assert.equal(noPrice.writes(), 0);
      const noProv = makeStore({ falConfigured: false });
      const rp = noProv.catalog.find((r) => r.model_id === plain)!;
      assert.equal((await toggle(noProv.store, rp.id, true, rp.updated_at)).body.code, "PROVIDER_NOT_CONFIGURED");

      // Registry view: dark model reports shipsDark, its price and where it would appear.
      const t = makeStore();
      const reg = buildModelRegistry({
        catalogRows: t.catalog.map((r) => ({ ...r })),
        featureRows: [],
        pricingRows: await t.store.listPricing(),
        modelConfigs: [],
        providerConfigured: () => true,
      }).find((m) => m.modelId === plain)!;
      assert.equal(reg.shipsDark, true);
      assert.equal(reg.enabled, false);
      assert.ok(reg.pricing.keys.every((k) => k.credits === 5));
      assert.ok(reg.willAppearIn.length > 0);

      // Happy path: add -> model_add audit with before/after; it then appears in the eligible composers' list.
      const row = t.catalog.find((r) => r.model_id === plain)!;
      const seen = row.updated_at;
      const added = await toggle(t.store, row.id, true, seen);
      assert.equal(added.status, 200);
      assert.equal(row.enabled, true);
      assert.deepEqual(
        { a: t.audits[0].action, b: t.audits[0].before, f: t.audits[0].after },
        { a: "model_add", b: { enabled: false }, f: { enabled: true } }
      );
      assert.equal(enabledIdsFromRows("photo", t.catalog).has(plain), true);
      const after = buildModelRegistry({
        catalogRows: t.catalog.map((r) => ({ ...r })),
        featureRows: [],
        pricingRows: await t.store.listPricing(),
        modelConfigs: [],
        providerConfigured: () => true,
      }).find((m) => m.modelId === plain)!;
      assert.deepEqual(after.enabledIn.map((f) => f.key).sort(), reg.willAppearIn.map((f) => f.key).sort());

      // Double submit is a no-op (one write, one audit); a stale token is a CAS conflict.
      const again = await toggle(t.store, row.id, true, seen);
      assert.equal(again.body.noop, true);
      assert.equal(t.writes(), 1);
      assert.equal(t.audits.length, 1);
      const c = makeStore();
      const cr = c.catalog.find((r) => r.model_id === plain)!;
      assert.equal((await toggle(c.store, cr.id, true, "stale")).body.code, "STALE_MODEL_CONFIG");

      // History unknown or already offered -> model_enable; audit failure never fails the add.
      for (const everOffered of [null, true]) {
        const u = makeStore({ everOffered });
        const ur = u.catalog.find((r) => r.model_id === plain)!;
        await toggle(u.store, ur.id, true, ur.updated_at);
        assert.equal(u.audits[0].action, "model_enable");
      }
      const af = makeStore({ auditFails: true });
      const ar = af.catalog.find((r) => r.model_id === plain)!;
      assert.equal((await toggle(af.store, ar.id, true, ar.updated_at)).status, 200);
      assert.equal(ar.enabled, true);
    } finally {
      delete tier.offeredByDefault;
    }
    assert.deepEqual(defaultModelCatalogRows().map((d) => `${d.toolKey}:${d.modelId}:${d.enabled}`), snapshot);
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

  // ---- Remove (archive) / Restore, migration 118 ----
  // Missing-column detection (Postgres 42703 and the PostgREST schema cache) vs. unrelated errors.
  assert.equal(isArchiveColumnMissing({ code: "42703", message: "column model_catalog_configs.archived_at does not exist" }), true);
  assert.equal(isArchiveColumnMissing({ code: "PGRST204", message: "Could not find the 'archived_at' column of 'model_catalog_configs' in the schema cache" }), true);
  assert.equal(isArchiveColumnMissing({ message: "connection reset" }), false);
  assert.equal(isArchiveColumnMissing(null), false);
  const archive = (s: ModelChangeStore, id: string, expectedUpdatedAt: unknown, on = true) =>
    applyCatalogArchive(s, { id, archive: on, expectedUpdatedAt, actorProfileId });

  // Happy path: archive hides the model, one audit row with before/after, in-flight jobs only warn.
  {
    const t = makeStore({ inFlight: 3 });
    const row = t.catalog.find((r) => r.model_id === plain)!;
    const r = await archive(t.store, row.id, row.updated_at);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(row.enabled, false);
    assert.ok(row.archived_at);
    assert.deepEqual((r.body.warnings as string[]).length, 1);
    assert.match((r.body.warnings as string[])[0], /3 jobs are still running/);
    assert.equal(t.audits.length, 1);
    assert.deepEqual(
      { a: t.audits[0].action, k: t.audits[0].configKey, b: t.audits[0].before, f: t.audits[0].after },
      { a: "model_archive", k: plain, b: { enabled: true, archived: false }, f: { enabled: false, archived: true } }
    );
    // Idempotent: repeating (even with a stale token) is a no-op without a write or audit row.
    const w = t.writes();
    const again = await archive(t.store, row.id, "stale");
    assert.equal(again.status, 200);
    assert.equal(again.body.noop, true);
    assert.equal(t.writes(), w);
    assert.equal(t.audits.length, 1);
    // An archived model cannot be offered through the toggle: restore first.
    const enable = await toggle(t.store, row.id, true, row.updated_at);
    assert.equal(enable.status, 409);
    assert.equal(enable.body.code, "ARCHIVED");
    assert.equal(row.enabled, false);
    // The registry keeps it (label resolves for history) but never offers it or lists it as addable.
    const reg = buildModelRegistry({
      catalogRows: await t.store.listCatalog(),
      featureRows: [],
      pricingRows: await t.store.listPricing(),
      modelConfigs: [],
      providerConfigured: () => true,
    }).find((m) => m.modelId === plain)!;
    assert.equal(reg.archived, true);
    assert.equal(reg.enabled, false);
    assert.equal(reg.availableToAdd, false);
    assert.ok(reg.label.length > 0 && reg.label !== "");
    assert.ok(!enabledIdsFromRows("photo", await t.store.listCatalog()).has(plain));
    // Restore: flag cleared, still not offered, one audit row; repeat is a no-op.
    const back = await archive(t.store, row.id, row.updated_at, false);
    assert.equal(back.status, 200, JSON.stringify(back.body));
    assert.equal(row.archived_at, null);
    assert.equal(row.enabled, false);
    assert.equal(t.audits.at(-1)!.action, "model_restore");
    const n = t.audits.length;
    assert.equal((await archive(t.store, row.id, "stale", false)).body.noop, true);
    assert.equal(t.audits.length, n);
    // After restore the normal add flow works again.
    assert.equal((await toggle(t.store, row.id, true, row.updated_at)).status, 200);
  }

  // Blocked by each guard rule; nothing is written.
  {
    const t = makeStore();
    const dflt = [...defaults][0];
    const d = t.catalog.find((r) => r.model_id === dflt)!;
    const isDef = await archive(t.store, d.id, d.updated_at);
    assert.equal(isDef.status, 409);
    assert.equal(isDef.body.code, "IS_DEFAULT");

    const reels = makeStore();
    reels.catalog.find((r) => r.model_id === "veo31_lite")!.enabled = false;
    const eng = reels.catalog.find((r) => r.model_id === "seedance2_fast")!;
    const lastEngine = await archive(reels.store, eng.id, eng.updated_at);
    assert.equal(lastEngine.status, 409);
    assert.ok((lastEngine.body.codes as string[]).includes("REELS_ENGINE_LAST"));

    const last = makeStore();
    for (const r of last.catalog) if (r.tool_key === "photo" && r.model_id !== plain) r.enabled = false;
    const only = last.catalog.find((r) => r.model_id === plain)!;
    const lastModel = await archive(last.store, only.id, only.updated_at);
    assert.equal(lastModel.status, 409);
    assert.ok((lastModel.body.codes as string[]).includes("LAST_ENABLED_MODEL"));
    assert.equal(t.writes() + reels.writes() + last.writes(), 0);
  }

  // Archiving a model that is not offered only sets the flag (nothing to hide).
  {
    const t = makeStore();
    const row = t.catalog.find((r) => r.model_id === plain)!;
    row.enabled = false;
    assert.equal((await archive(t.store, row.id, row.updated_at)).status, 200);
    assert.ok(row.archived_at);
  }

  // Stale token -> 409, 404, 400; audit failure never blocks.
  {
    const t = makeStore({ auditFails: true });
    const row = t.catalog.find((r) => r.model_id === plain)!;
    const stale = await archive(t.store, row.id, "old");
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, "STALE_MODEL_CONFIG");
    assert.equal(row.archived_at, undefined);
    assert.equal((await archive(t.store, "nope", "x")).status, 404);
    assert.equal((await archive(t.store, row.id, undefined)).status, 400);
    assert.equal((await archive(t.store, row.id, row.updated_at)).status, 200);
    assert.equal(t.audits.length, 0);
  }

  // Migration 118 NOT applied: inert. Remove/Restore -> 409 MIGRATION_REQUIRED, nothing written,
  // and the existing toggle keeps working exactly as before.
  {
    const t = makeStore({ archiveAvailable: false });
    const row = t.catalog.find((r) => r.model_id === plain)!;
    for (const on of [true, false]) {
      const r = await archive(t.store, row.id, row.updated_at, on);
      assert.equal(r.status, 409);
      assert.equal(r.body.code, "MIGRATION_REQUIRED");
      assert.equal(r.body.error, "Run migration 118 to enable archiving");
    }
    assert.equal(t.writes(), 0);
    assert.equal((await toggle(t.store, row.id, false, row.updated_at)).status, 200);
    assert.equal((await toggle(t.store, row.id, true, row.updated_at)).status, 200);
    // Registry without the column: nothing archived, every archive check still computed.
    const reg = buildModelRegistry({ catalogRows: await t.store.listCatalog(), featureRows: [], pricingRows: [], modelConfigs: [] });
    assert.ok(reg.every((m) => m.archived === false));
    // The probe can race the migration: a missing column at write time maps to the same 409.
    const racy = makeStore();
    racy.store.casArchive = async () => {
      throw Object.assign(new Error("x"), { name: "ArchiveMigrationRequiredError" });
    };
    const rr = racy.catalog.find((r) => r.model_id === plain)!;
    assert.equal((await archive(racy.store, rr.id, rr.updated_at)).body.code, "MIGRATION_REQUIRED");
  }

  // L1: feature-row reset goes through the same guard, CAS and audit.
  {
    const t = makeStore();
    const tiers = eligibleTiersForFeature("image");
    const dflt = defaultTierForFeature("image");
    const other = tiers.find((x) => x !== dflt)!;
    const mk = (tier: string, enabled: boolean, is_default: boolean): FeatureRowFull => ({
      id: `r-${tier}`, tool_key: "photo", feature_key: "image", model_tier: tier, enabled, is_default, updated_at: stamp(),
    });
    // An admin made `other` the default; the shipped default is `dflt`.
    const o = mk(other, true, true);
    const d = mk(dflt, true, false);
    t.features.push(o, d);
    const reset = (id: string, exp: unknown) => applyFeatureModelReset(t.store, { id, expectedUpdatedAt: exp, actorProfileId });
    // Resetting `other` would clear the DB default without a replacement -> blocked.
    const blocked = await reset(o.id, o.updated_at);
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.code, "IS_DEFAULT");
    assert.equal(o.is_default, true);
    assert.equal((await reset(o.id, undefined)).status, 400);
    assert.equal((await reset(d.id, "stale")).body.code, "STALE_MODEL_CONFIG");
    // Resetting the shipped default restores it as the single default, audited once.
    const ok = await reset(d.id, d.updated_at);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(d.is_default, true);
    assert.equal(o.is_default, false);
    assert.equal(t.audits.at(-1)!.action, "feature_model_reset");
    assert.equal(t.audits.length, 1);
    // Repeat is a no-op.
    assert.equal((await reset(d.id, d.updated_at)).body.noop, true);
    assert.equal(t.audits.length, 1);
  }

  // L2: hiding the last Reels Creator engine row is refused even though other (non-engine) models remain.
  {
    const t = makeStore();
    const veo = { id: "e-veo", tool_key: "reels", feature_key: "reels-creator", model_tier: "veo31_lite", enabled: true, is_default: false, updated_at: stamp() };
    const seed = { id: "e-seed", tool_key: "reels", feature_key: "reels-creator", model_tier: "seedance2_fast", enabled: true, is_default: false, updated_at: stamp() };
    t.features.push(veo, seed);
    const off = (id: string, exp: string) => applyFeatureModelChange(t.store, { id, patch: { enabled: false }, expectedUpdatedAt: exp, actorProfileId });
    assert.equal((await off(veo.id, veo.updated_at)).status, 200);
    const last = await off(seed.id, seed.updated_at);
    assert.equal(last.status, 409);
    assert.equal(last.body.code, "REELS_ENGINE_LAST");
    assert.equal(seed.enabled, true);
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
