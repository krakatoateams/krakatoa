import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  isModelStateUnavailable,
  isTableMissing,
  modelStateUnavailableResponse,
  ModelStateUnavailableError,
  ModelTableMissingError,
} from "./model-state-unavailable";
import { defaultModelCatalogRows } from "./model-catalog-configs";
import { PRODUCT_PHOTO_TIERS } from "./product-photo";

/**
 * Admin model state fails CLOSED: an unreadable state offers nothing and rejects generation before
 * any spend/provider call; a missing table keeps the shipped code defaults.
 */
console.warn = () => {};
// The readers import the Supabase client; no query is ever sent (every read below is injected).
process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "self-check";

async function rejectsClosed(label: string, p: Promise<unknown>) {
  await assert.rejects(p, (e) => isModelStateUnavailable(e), label);
}

const boom = () => Promise.reject(new Error("connection reset"));
const missingFeature = () => Promise.reject(new ModelTableMissingError("feature_model_configs missing"));
const rows = (tool: string, modelId: string, enabled: boolean) => ({
  id: "x", tool_key: tool, model_id: modelId, enabled, sort_order: 0, metadata: {},
  updated_by_profile_id: null, created_at: "", updated_at: "",
});
const okCatalog = async (t: "photo" | "reels") => new Set(defaultModelCatalogRows().filter((r) => r.toolKey === t && r.enabled).map((r) => r.modelId));

async function main() {
  const { getPhotoFeatureEnablement, getVideoComposerEnablement } = await import("./feature-model-configs-db");
  const { getEnabledCatalogModelIds } = await import("./model-catalog-configs-db");
  // Every reader fails closed on a read error.
  await rejectsClosed("catalog reader (photo)", getEnabledCatalogModelIds("photo", boom));
  await rejectsClosed("catalog reader timeout", getEnabledCatalogModelIds("photo", () => new Promise(() => {}), 20));
  await rejectsClosed("catalog reader (reels)", getEnabledCatalogModelIds("reels", boom));
  await rejectsClosed("photo: feature rows fail", getPhotoFeatureEnablement({ listRows: boom, catalogIds: okCatalog }));
  await rejectsClosed("photo: catalog fails", getPhotoFeatureEnablement({ listRows: async () => [], catalogIds: () => Promise.reject(new Error("x")) }));
  await rejectsClosed("video: feature rows fail", getVideoComposerEnablement({ listRows: boom, catalogIds: okCatalog }));
  await rejectsClosed("video: catalog fails", getVideoComposerEnablement({ listRows: async () => [], catalogIds: () => Promise.reject(new Error("x")) }));
  await rejectsClosed("video: catalog throws closed", getVideoComposerEnablement({ listRows: async () => [], catalogIds: () => Promise.reject(new ModelStateUnavailableError()) }));

  // Table missing = no admin state can exist: shipped defaults (ship-dark stays hidden).
  const noTable = () => Promise.reject(new ModelTableMissingError("model_catalog_configs missing"));
  const defaults = await getEnabledCatalogModelIds("photo", noTable);
  assert.deepEqual([...defaults].sort(), [...(await okCatalog("photo"))].sort());
  const photo = await getPhotoFeatureEnablement({ listRows: missingFeature, catalogIds: okCatalog });
  assert.ok(Object.values(photo).every((f) => f.enabledTiers.length > 0));
  const video = await getVideoComposerEnablement({ listRows: missingFeature, catalogIds: (t) => getEnabledCatalogModelIds(t, noTable) });
  assert.ok(Object.values(video).every((f) => f.enabledTiers.length > 0));

  // Archived / disabled stay blocked on the normal path.
  const tier = PRODUCT_PHOTO_TIERS[0].id;
  const off = await getEnabledCatalogModelIds("photo", async () => [rows("photo", tier, false)]);
  assert.ok(!off.has(tier));
  const catalogWithoutTier = async () => off;
  const blocked = await getPhotoFeatureEnablement({ listRows: async () => [], catalogIds: catalogWithoutTier });
  assert.ok(Object.values(blocked).every((f) => !f.enabledTiers.includes(tier)));

  // Error classification.
  assert.ok(isTableMissing({ code: "PGRST205", message: "Could not find the table 'public.t' in the schema cache" }, "t"));
  assert.ok(isTableMissing({ code: "42P01", message: 'relation "public.t" does not exist' }, "t"));
  assert.ok(!isTableMissing({ code: "PGRST205", message: "Could not find the table 'public.other' in the schema cache" }, "t"));
  assert.ok(!isTableMissing({ code: "PGRST205", message: "Could not find the table 'public.feature_model_configs' in the schema cache" }, "model_configs"));
  assert.ok(!isTableMissing({ message: 'relation "t" does not exist' }, "t"), "no code: unknown state");
  // Schema drift: a missing column is not a missing table.
  assert.ok(!isTableMissing({ code: "42703", message: 'column t.archived_at does not exist' }, "t"));
  assert.ok(!isTableMissing({ code: "PGRST204", message: "Could not find the 'archived_at' column of 't' in the schema cache" }, "t"));
  assert.ok(!isTableMissing({ message: "connection reset" }, "t"));
  assert.ok(!isTableMissing({ message: "timeout reading t" }, "t"));

  // Routes: retryable 503 helper, handler present, and the read precedes any spend/provider work.
  const res = modelStateUnavailableResponse();
  assert.equal(res.status, 503);
  assert.equal((await res.json()).retryable, true);
  for (const [route, reader] of [
    ["generate-photo", "getPhotoFeatureEnablement()"],
    ["generate-video", "getVideoComposerEnablement()"],
    ["generate-reels", "getVideoComposerEnablement()"],
    ["generate-motion-control", "getVideoComposerEnablement()"],
    ["generate-storyboard-video", "getVideoComposerEnablement()"],
  ]) {
    const src = readFileSync(`app/api/${route}/route.ts`, "utf8");
    const read = src.indexOf(reader);
    const spend = src.indexOf("beginMeteredAttempt({");
    assert.ok(read > 0 && spend > read, `${route}: enablement read before any spend/job/provider work (all of which follow beginMeteredAttempt)`);
    const near = src.slice(read, read + 260);
    assert.ok(near.includes("isModelStateUnavailable(e)") && near.includes("modelStateUnavailableResponse()"), `${route}: 503 handler`);
  }
  for (const route of ["photo", "video"]) {
    const src = readFileSync(`app/api/tools/${route}/features/route.ts`, "utf8");
    assert.ok(src.includes("modelStateUnavailableResponse()"), `${route} features: 503`);
  }
  console.log("model-state fail-closed self-check passed");
}

main();
