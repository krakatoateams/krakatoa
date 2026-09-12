import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const expirySource = readFileSync(
  new URL("./creation-expiry.ts", import.meta.url),
  "utf8"
);

assert.match(
  expirySource,
  /count: "exact", head: true/,
  "dry-run counts must not stop at the PostgREST row cap"
);
assert.match(
  expirySource,
  /\.limit\(CREATION_EXPIRY_BATCH_SIZE\)/,
  "live expiry must drain the complete backlog in bounded batches"
);
assert.match(
  expirySource,
  /while \(batches < maxBatches\)/,
  "each invocation must stop before an unbounded backlog consumes its timeout"
);
assert.match(
  expirySource,
  /partial: remaining > 0/,
  "bounded runs must report unfinished backlog"
);
assert.match(
  expirySource,
  /opts\?\.expectedDays !== undefined && opts\.expectedDays !== days/,
  "live creation expiry must reject a changed retention policy"
);
assert.doesNotMatch(
  expirySource,
  /opts\?\.cutoff/,
  "callers must not be able to supply an arbitrary destructive cutoff"
);

const rowDeleteIndex = expirySource.indexOf(
  `.from(USER_CREATIONS_TABLE)\n      .delete()`
);
const storageDeleteIndex = expirySource.indexOf(
  `.from(STORAGE_BUCKET)\n        .remove(`
);
assert.notEqual(rowDeleteIndex, -1, "creation-row deletion must be present");
assert.notEqual(storageDeleteIndex, -1, "storage deletion must be present");
assert.ok(
  rowDeleteIndex < storageDeleteIndex,
  "DB rows must be deleted before best-effort storage cleanup"
);

const adminPageSource = readFileSync(
  new URL("../app/(app)/admin/expiry/page.tsx", import.meta.url),
  "utf8"
);
assert.match(
  adminPageSource,
  /requestRun\(true\)/,
  "manual expiry must preview the affected count before mutation"
);
assert.match(
  adminPageSource,
  /window\.confirm/,
  "manual expiry must require explicit destructive confirmation"
);
assert.match(
  adminPageSource,
  /requestRun\(false, r\)/,
  "live expiry must reuse the preview checkpoint"
);
assert.match(
  adminPageSource,
  /expectedDays:/,
  "the preview checkpoint must bind the live retention setting"
);
assert.match(
  adminPageSource,
  /Math\.min\(r\.scanned, r\.maxDeletes\)/,
  "confirmation must state the bounded per-run delete count"
);
assert.match(
  adminPageSource,
  /if \(dirty\)/,
  "manual expiry must not ignore unsaved retention edits"
);

const adminRouteSource = readFileSync(
  new URL("../app/api/admin/expiry/run/route.ts", import.meta.url),
  "utf8"
);
assert.match(
  adminRouteSource,
  /getExpirySettings\(\{ fresh: true \}\)/,
  "destructive preview/live checks must bypass a stale settings cache"
);

console.log("creation expiry self-check passed");
