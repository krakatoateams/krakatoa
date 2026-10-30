import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FAL_PHOTO_MODELS } from "./ai-providers/fal-photo-catalog";
import { buildModelImpact, providerSlugsFor, type ImpactCountScope, type ModelImpactReads } from "./model-impact";
import { buildModelRegistry } from "./model-registry";
import { PRODUCT_PHOTO_TIERS } from "./product-photo";
import { setFeatureDefaultSafely } from "./feature-default-switch";
import { modelPricingKeys } from "./model-pricing-keys";

async function main() {
// A photo tier with a Fal binding counts both its Replicate slug and the Fal slug (and the current model_configs slug).
const tier = PRODUCT_PHOTO_TIERS.find((t) => Object.values(FAL_PHOTO_MODELS).some((f) => f.configKey === t.modelRole))!;
const falSlugs = Object.entries(FAL_PHOTO_MODELS).filter(([, f]) => f.configKey === tier.modelRole).map(([slug]) => slug);
const slugs = providerSlugsFor("photo", tier.id, [
  { tool_key: "photo", config_key: tier.modelRole, provider: "fal", model: falSlugs[0], enabled: true },
]);
assert.deepEqual(new Set(slugs), new Set([tier.providerModel, ...falSlugs]));
assert.ok(slugs.length >= 2);

// Fixture rows keyed by the provider slug columns; the reads object is the ONLY thing the builder can call (read-only).
const NOW = Date.parse("2026-06-30T00:00:00Z");
const day = 86_400_000;
type Row = { table: ImpactCountScope["table"]; model: string; at: number; status?: string };
const rows: Row[] = [
  { table: "jobs", model: tier.providerModel, at: NOW - day, status: "running" },
  { table: "jobs", model: falSlugs[0], at: NOW - 2 * day, status: "queued" },
  { table: "jobs", model: falSlugs[0], at: NOW - 40 * day, status: "succeeded" },
  { table: "jobs", model: "some/other-model", at: NOW - day, status: "running" },
  { table: "assets", model: tier.providerModel, at: NOW - 5 * day },
  { table: "assets", model: falSlugs[0], at: NOW - 90 * day },
  { table: "usage_events", model: falSlugs[0], at: NOW - day },
];
let calls = 0;
const reads: ModelImpactReads = {
  async count(s, scope) {
    calls++;
    const since = scope.sinceIso ? Date.parse(scope.sinceIso) : -Infinity;
    return rows.filter(
      (r) =>
        r.table === scope.table &&
        s.includes(r.model) &&
        r.at >= since &&
        (!scope.inFlight || ["queued", "running", "recoverable"].includes(r.status ?? ""))
    ).length;
  },
  async skillsDesignating(id) {
    calls++;
    return id === tier.id ? ["skill-a"] : [];
  },
};

const model = buildModelRegistry({
  catalogRows: [],
  featureRows: [],
  pricingRows: modelPricingKeys("photo", tier.id).map((k) => ({ pricing_key: k, enabled: true, is_deprecated: false, credit_amount: 5 })),
  modelConfigs: [{ tool_key: "photo", config_key: tier.modelRole, provider: "fal", model: falSlugs[0], enabled: true }],
  providerConfigured: () => true,
}).find((m) => m.modelId === tier.id)!;

const impact = await buildModelImpact({
  model,
  modelConfigs: [{ tool_key: "photo", config_key: tier.modelRole, provider: "fal", model: falSlugs[0], enabled: true }],
  reads,
  now: NOW,
});
assert.equal(impact.counts.inFlightJobs, 2);
assert.deepEqual(impact.counts.jobs, { last30Days: 2, allTime: 3 });
assert.deepEqual(impact.counts.assets, { last30Days: 1, allTime: 2 });
assert.deepEqual(impact.counts.usageEvents, { last30Days: 1, allTime: 1 });
assert.deepEqual(impact.skills, ["skill-a"]);
assert.deepEqual(impact.pricingKeys, modelPricingKeys("photo", tier.id));
assert.ok(calls > 0 && !JSON.stringify(impact).includes("profile"));

// A failing read degrades to null (unknown), never throws.
const flaky = await buildModelImpact({
  model,
  modelConfigs: [],
  reads: { count: async () => Promise.reject(new Error("db down")), skillsDesignating: async () => null },
  now: NOW,
});
assert.equal(flaky.counts.inFlightJobs, null);
assert.equal(flaky.skills, null);

// The impact route is read-only and admin-only; the DB reads are head-only counts.
const route = readFileSync("app/api/admin/config/model-catalog/[id]/impact/route.ts", "utf8");
assert.match(route, /withAdmin\(/);
assert.doesNotMatch(route, /\.(insert|update|upsert|delete)\(|export async function (POST|PATCH|PUT|DELETE)/);
const dbReads = readFileSync("lib/model-impact-db.ts", "utf8");
assert.match(dbReads, /head: true/);
assert.doesNotMatch(dbReads, /\.(insert|update|upsert|delete)\(/);
for (const k of ["archive", "restore"]) {
  assert.match(readFileSync(`app/api/admin/config/model-catalog/[id]/${k}/route.ts`, "utf8"), /withAdmin\(/);
}
assert.match(readFileSync("app/api/admin/config/feature-models/[id]/reset/route.ts", "utf8"), /applyFeatureModelReset/);

// L3: switching a default never persists two defaults on a failure.
{
  const log: string[] = [];
  const mk = (over: { target?: object | null; clearFails?: boolean; revertFails?: boolean }) => ({
    makesDefault: true,
    writeTarget: async () => {
      log.push("write");
      return over.target === undefined ? { id: 1 } : over.target;
    },
    clearOthers: async () => {
      log.push("clear");
      if (over.clearFails) throw new Error("db error");
    },
    revertTarget: async () => {
      log.push("revert");
      if (over.revertFails) throw new Error("revert failed");
    },
    onCompensationFailed: () => log.push("compensation-failed"),
  });
  assert.deepEqual(await setFeatureDefaultSafely(mk({})), { id: 1 });
  assert.deepEqual(log, ["write", "clear"]);

  log.length = 0;
  assert.equal(await setFeatureDefaultSafely(mk({ target: null })), null);
  assert.deepEqual(log, ["write"], "a lost compare-and-set must not clear anyone else's default");

  log.length = 0;
  await assert.rejects(setFeatureDefaultSafely(mk({ clearFails: true })), /db error/);
  assert.deepEqual(log, ["write", "clear", "revert"], "a failed clear is compensated before the error surfaces");

  log.length = 0;
  await assert.rejects(setFeatureDefaultSafely(mk({ clearFails: true, revertFails: true })), /db error/);
  assert.deepEqual(log, ["write", "clear", "revert", "compensation-failed"]);

  log.length = 0;
  await setFeatureDefaultSafely({ ...mk({}), makesDefault: false });
  assert.deepEqual(log, ["write"]);
}

  console.log("model-impact self-check passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
