/**
 * Proves the signed-URL cache actually saves egress.
 *
 *   npm run probe:signed-url-cache
 *
 * A typecheck cannot show any of the three things that matter here, because all
 * three are properties of the live Supabase project, not of our code:
 *
 *   1. Signing the same path twice returns the SAME URL. If it doesn't, every page
 *      view hands the browser a URL it has never seen and re-downloads the file —
 *      the exact bug this cache exists to fix.
 *   2. Short-TTL (publish) signing is NOT cached, so social platforms and Rendi keep
 *      getting fresh, short-lived URLs.
 *   3. A conditional GET on the cached URL answers 304 with a zero-byte body. This is
 *      the payoff: a repeat view costs no egress at all.
 *
 * Reads one small object once (a few hundred KB at most) and writes only to
 * signed_url_cache. Picks the smallest object available to keep that cost trivial.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadEnv() {
  for (const line of readFileSync(resolve(__dirname, "../.env.local"), "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = v;
  }
}

function assert(ok: boolean, msg: string) {
  if (!ok) throw new Error(msg);
  console.log(`  ok  ${msg}`);
}

async function main() {
  loadEnv();
  const { createSignedStorageUrl, SIGN_TTL } = await import("../lib/storage-signed-url");
  const { supabaseServer } = await import("../lib/supabase-server");
  const { STORAGE_BUCKET } = await import("../lib/storage-buckets");

  // A real path the app would actually sign. Photos over videos so the one
  // unavoidable download stays small.
  const { data: rows, error } = await supabaseServer
    .from("user_creations")
    .select("storage_path")
    .not("storage_path", "is", null)
    .eq("media_type", "image")
    .limit(50);
  if (error) throw new Error(`could not read user_creations: ${error.message}`);

  const paths = (rows ?? [])
    .map((r) => r.storage_path as string)
    .filter((p) => /^[a-zA-Z0-9-]+\/(photos|videos)\//.test(p));
  if (!paths.length) {
    console.log("no user media with a storage_path — nothing to probe");
    return;
  }

  // One list call on a single folder is enough to pick the smallest candidate.
  const dir = paths[0]!.slice(0, paths[0]!.lastIndexOf("/"));
  const { data: listed } = await supabaseServer.storage.from(STORAGE_BUCKET).list(dir, {
    limit: 100,
  });
  const inDir = new Set(paths.filter((p) => p.startsWith(`${dir}/`)));
  const smallest = (listed ?? [])
    .map((o) => ({
      name: `${dir}/${o.name}`,
      size: Number((o.metadata as { size?: number } | null)?.size ?? Infinity),
    }))
    .filter((o) => inDir.has(o.name) && Number.isFinite(o.size))
    .sort((a, b) => a.size - b.size)[0];

  const target = smallest ?? { name: paths[0]!, size: NaN };
  const sizeLabel = Number.isFinite(target.size)
    ? `${(target.size / 1024).toFixed(0)} kB`
    : "unknown size";
  console.log(`target: ${target.name} (${sizeLabel})\n`);

  console.log("1. long TTL is stable across calls");
  const a = await createSignedStorageUrl(target.name, "ui");
  const b = await createSignedStorageUrl(target.name, "ui");
  assert(a.url === b.url, "two 'ui' signings returned the same URL");
  assert(
    new Date(a.expiresAt).getTime() - Date.now() > 20 * 24 * 3600 * 1000,
    `'ui' URL is long-lived (TTL ${SIGN_TTL.ui}s)`,
  );

  // Note: two signings inside the same second are byte-identical anyway, because the
  // token is a JWT whose iat/exp have second resolution. That is why the missing cache
  // was invisible within a single request (history signs 100 items at once) and only
  // showed up across page loads. So this checks the stored state, not URL equality.
  console.log("\n2. short TTL is not cached");
  await createSignedStorageUrl(target.name, "publish");
  const { data: shortRows } = await supabaseServer
    .from("signed_url_cache")
    .select("ttl_sec")
    .eq("storage_path", target.name)
    .eq("ttl_sec", SIGN_TTL.publish);
  assert((shortRows ?? []).length === 0, "'publish' signing wrote no cache row");

  const { data: longRows } = await supabaseServer
    .from("signed_url_cache")
    .select("ttl_sec")
    .eq("storage_path", target.name)
    .eq("ttl_sec", SIGN_TTL.ui);
  assert((longRows ?? []).length === 1, "'ui' signing wrote exactly one cache row");

  // The sign endpoints accept a numeric `ttl` straight from the request. If caching
  // ever keys off a range instead of an exact match, each distinct value mints its own
  // row and any logged-in user can fill the 500 MB free-plan database from one object.
  console.log("\n3. an arbitrary numeric TTL is never cached");
  const oddTtl = SIGN_TTL.ui - 7;
  await createSignedStorageUrl(target.name, oddTtl);
  const { data: oddRows } = await supabaseServer
    .from("signed_url_cache")
    .select("ttl_sec")
    .eq("storage_path", target.name)
    .eq("ttl_sec", oddTtl);
  assert((oddRows ?? []).length === 0, `ttl=${oddTtl} wrote no cache row`);

  console.log("\n4. a repeat view costs no bytes");
  const first = await fetch(a.url);
  assert(first.ok, `first GET returned ${first.status}`);
  const etag = first.headers.get("etag");
  const bytes = (await first.arrayBuffer()).byteLength;
  assert(Boolean(etag), `origin sent an ETag (${bytes} bytes downloaded)`);

  const second = await fetch(a.url, { headers: { "If-None-Match": etag! } });
  const secondBytes = (await second.arrayBuffer()).byteLength;
  assert(second.status === 304, `conditional GET returned 304 (was ${second.status})`);
  assert(secondBytes === 0, `conditional GET downloaded 0 bytes (was ${secondBytes})`);

  console.log("\nprobe-signed-url-cache: ok");
}

main().catch((e) => {
  console.error("\nprobe-signed-url-cache FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
