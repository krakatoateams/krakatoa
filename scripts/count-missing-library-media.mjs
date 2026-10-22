// Read-only: counts My Library entries (user_creations) whose storage object
// no longer exists — the blank tiles from #385. Nothing is changed or deleted.
//
// Run:  npm run library:count-missing            (summary)
//       npm run library:count-missing -- --json  (also print the affected rows)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv(path) {
  const out = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[t.slice(0, eq).trim()] = v;
  }
  return out;
}

const env = loadEnv(new URL("../.env.local", import.meta.url).pathname);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const BUCKET = env.SUPABASE_STORAGE_BUCKET || "krakatoa";
const PAGE = 500;
const SIGN_BATCH = 100;
const asJson = process.argv.includes("--json");

let checked = 0;
let skippedNoPath = 0;
const missing = [];

for (let from = 0; ; from += PAGE) {
  const { data: rows, error } = await sb
    .from("user_creations")
    .select("id, user_id, tool, media_type, storage_path, created_at")
    .order("created_at", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) throw new Error(`user_creations read failed: ${error.message}`);
  if (!rows?.length) break;

  const withPath = rows.filter((r) => {
    const ok = typeof r.storage_path === "string" && r.storage_path.trim() !== "" && !/^https?:/i.test(r.storage_path);
    if (!ok) skippedNoPath++;
    return ok;
  });

  for (let i = 0; i < withPath.length; i += SIGN_BATCH) {
    const batch = withPath.slice(i, i + SIGN_BATCH);
    // Signing is read-only; a missing object comes back as a per-path error.
    const { data, error: signErr } = await sb.storage
      .from(BUCKET)
      .createSignedUrls(batch.map((r) => r.storage_path), 60);
    if (signErr) throw new Error(`signing failed: ${signErr.message}`);
    data.forEach((entry, j) => {
      checked++;
      if (entry.error || !entry.signedUrl) missing.push(batch[j]);
    });
  }
  if (rows.length < PAGE) break;
}

const byKind = {};
for (const row of missing) {
  const key = `${row.media_type}/${row.tool}`;
  byKind[key] = (byKind[key] ?? 0) + 1;
}

console.log(`Checked ${checked} library entries with a storage path (${skippedNoPath} without one skipped).`);
console.log(`Missing file: ${missing.length}`);
for (const [key, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) console.log(`  ${key}: ${n}`);
console.log(`Users affected: ${new Set(missing.map((r) => r.user_id)).size}`);
if (asJson) console.log(JSON.stringify(missing, null, 2));
