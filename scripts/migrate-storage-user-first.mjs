/**
 * Move user media from legacy layout to user-first layout.
 *
 *   photos/{userId}/rest  →  {userId}/photos/rest
 *   videos/{userId}/rest  →  {userId}/videos/rest
 *
 * Sources (merged, deduped by old path):
 *   - DB rows (assets, user_creations, storyboards, posts)
 *   - Storage scan under photos/ + videos/ (--no-scan-storage to skip)
 *
 *   node scripts/migrate-storage-user-first.mjs                        # dry-run
 *   node scripts/migrate-storage-user-first.mjs --execute              # apply moves + DB updates
 *   node scripts/migrate-storage-user-first.mjs --execute --prune-stale-db
 *   node scripts/migrate-storage-user-first.mjs --execute --delete-global-temp
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "krakatoa";
const LEGACY_ROOTS = ["photos", "videos"];
const GLOBAL_TEMP_PREFIX = /^videos\/temp\//;
const RESERVED_LEGACY_SEGMENTS = new Set(["temp", "storyboard"]);

function loadEnv() {
  const out = {};
  const path = new URL("../.env.local", import.meta.url).pathname;
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

function pathFromPublicUrl(url) {
  if (!url) return null;
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx !== -1) return decodeURIComponent(url.slice(idx + marker.length));
  return null;
}

function publicUrlFor(supabaseUrl, storagePath) {
  const encoded = storagePath
    .split("/")
    .map((s) => encodeURIComponent(s).replace(/%2F/g, "/"))
    .join("/");
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${encoded}`;
}

function isUserFirstPath(path) {
  return /^[a-zA-Z0-9-]+\/(?:photos|videos)\//.test(path);
}

function isLegacyUserMediaPath(path) {
  const m = path.match(/^(?:photos|videos)\/([a-zA-Z0-9-]+)\//);
  if (!m || RESERVED_LEGACY_SEGMENTS.has(m[1])) return false;
  return true;
}

function targetPath(oldPath) {
  const photo = oldPath.match(/^photos\/([a-zA-Z0-9-]+)\/(.+)$/);
  if (photo) return `${photo[1]}/photos/${photo[2]}`;
  const video = oldPath.match(/^videos\/([a-zA-Z0-9-]+)\/(.+)$/);
  if (video) return `${video[1]}/videos/${video[2]}`;
  return null;
}

async function walkStorage(sb, prefix) {
  const out = [];
  async function list(p) {
    let offset = 0;
    for (;;) {
      const { data, error } = await sb.storage.from(BUCKET).list(p, { limit: 1000, offset });
      if (error) throw new Error(`storage.list failed at "${p}": ${error.message}`);
      for (const e of data ?? []) {
        const full = p ? `${p}/${e.name}` : e.name;
        if (e.id === null) await list(full);
        else out.push(full);
      }
      if ((data?.length ?? 0) < 1000) break;
      offset += 1000;
    }
  }
  await list(prefix);
  return out;
}

async function objectExists(sb, path) {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const name = slash === -1 ? path : path.slice(slash + 1);
  const { data, error } = await sb.storage.from(BUCKET).list(dir, { search: name, limit: 1 });
  if (error) return false;
  return (data ?? []).some((e) => e.name === name);
}

async function main() {
  const execute = process.argv.includes("--execute");
  const scanStorage = !process.argv.includes("--no-scan-storage");
  const pruneStaleDb = process.argv.includes("--prune-stale-db");
  const deleteGlobalTemp = process.argv.includes("--delete-global-temp");

  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const sb = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  /** @type {Map<string, { oldPath: string, newPath: string, sources: string[] }>} */
  const plan = new Map();
  /** @type {string[]} */
  const globalTempPaths = [];

  const ingest = (storagePath, source) => {
    if (!storagePath || isUserFirstPath(storagePath)) return;
    if (GLOBAL_TEMP_PREFIX.test(storagePath) && !isLegacyUserMediaPath(storagePath)) {
      globalTempPaths.push(storagePath);
      return;
    }
    if (!isLegacyUserMediaPath(storagePath)) return;
    const newPath = targetPath(storagePath);
    if (!newPath || newPath === storagePath) return;
    const entry = plan.get(storagePath) ?? { oldPath: storagePath, newPath, sources: [] };
    if (!entry.sources.includes(source)) entry.sources.push(source);
    plan.set(storagePath, entry);
  };

  const { data: assets } = await sb
    .from("assets")
    .select("id, storage_path")
    .not("storage_path", "is", null)
    .is("deleted_at", null);
  for (const a of assets ?? []) ingest(a.storage_path, `assets:${a.id}`);

  const { data: creations } = await sb
    .from("user_creations")
    .select("id, storage_path")
    .neq("storage_path", "");
  for (const c of creations ?? []) ingest(c.storage_path, `user_creations:${c.id}`);

  const { data: storyboards } = await sb
    .from("storyboards")
    .select("id, storyboard_url, video_url");
  for (const s of storyboards ?? []) {
    const img = pathFromPublicUrl(s.storyboard_url);
    if (img) ingest(img, `storyboards.img:${s.id}`);
    const vid = pathFromPublicUrl(s.video_url);
    if (vid) ingest(vid, `storyboards.vid:${s.id}`);
  }

  const { data: posts } = await sb.from("posts").select("id, video_url").not("video_url", "is", null);
  for (const p of posts ?? []) {
    const path = pathFromPublicUrl(p.video_url);
    if (path) ingest(path, `posts:${p.id}`);
  }

  if (scanStorage) {
    for (const root of LEGACY_ROOTS) {
      const paths = await walkStorage(sb, root);
      for (const p of paths) ingest(p, "storage-scan");
    }
  }

  const moves = [...plan.values()].sort((a, b) => a.oldPath.localeCompare(b.oldPath));
  const uniqueGlobalTemp = [...new Set(globalTempPaths)].sort();

  console.log(`\n${execute ? "EXECUTE" : "DRY-RUN"}: ${moves.length} storage move(s)`);
  if (uniqueGlobalTemp.length) {
    console.log(`Global transient (no userId): ${uniqueGlobalTemp.length} under videos/temp/`);
  }
  console.log("");

  for (const m of moves) {
    console.log(`  ${m.oldPath}`);
    console.log(`    → ${m.newPath}`);
    console.log(`    (${m.sources.join(", ")})\n`);
  }

  for (const p of uniqueGlobalTemp) {
    console.log(`  [global-temp] ${p}`);
  }
  if (uniqueGlobalTemp.length) console.log("");

  /** @type {{ table: string, id: string, storage_path: string }[]} */
  const staleDb = [];
  for (const a of assets ?? []) {
    if (!a.storage_path || isUserFirstPath(a.storage_path)) continue;
    if (!isLegacyUserMediaPath(a.storage_path)) continue;
    const newPath = targetPath(a.storage_path);
    const exists =
      (await objectExists(sb, a.storage_path)) ||
      (newPath ? await objectExists(sb, newPath) : false);
    if (!exists) staleDb.push({ table: "assets", id: a.id, storage_path: a.storage_path });
  }
  for (const c of creations ?? []) {
    if (!c.storage_path || isUserFirstPath(c.storage_path)) continue;
    if (!isLegacyUserMediaPath(c.storage_path)) continue;
    const newPath = targetPath(c.storage_path);
    const exists =
      (await objectExists(sb, c.storage_path)) ||
      (newPath ? await objectExists(sb, newPath) : false);
    if (!exists) staleDb.push({ table: "user_creations", id: c.id, storage_path: c.storage_path });
  }

  if (staleDb.length) {
    console.log(`Stale DB rows (legacy path, file missing): ${staleDb.length}`);
    for (const row of staleDb) {
      console.log(`  [${row.table}] ${row.id} → ${row.storage_path}`);
    }
    console.log("");
  }

  if (!execute) {
    console.log(
      "Re-run with --execute to apply. Optional: --prune-stale-db --delete-global-temp\n",
    );
    return;
  }

  const movedOldPaths = new Set();
  let moved = 0;
  let skipped = 0;

  for (const m of moves) {
    const { error: moveErr } = await sb.storage.from(BUCKET).move(m.oldPath, m.newPath);
    if (moveErr) {
      if (/not found|does not exist/i.test(moveErr.message)) {
        console.warn(`[skip] storage missing: ${m.oldPath}`);
        skipped++;
        continue;
      }
      throw new Error(`move ${m.oldPath}: ${moveErr.message}`);
    }
    moved++;
    movedOldPaths.add(m.oldPath);
    console.log(`[moved] ${m.oldPath} → ${m.newPath}`);
  }

  for (const a of assets ?? []) {
    if (!movedOldPaths.has(a.storage_path)) continue;
    const newPath = plan.get(a.storage_path)?.newPath;
    if (!newPath) continue;
    await sb
      .from("assets")
      .update({ storage_path: newPath, public_url: publicUrlFor(supabaseUrl, newPath) })
      .eq("id", a.id);
  }

  for (const c of creations ?? []) {
    if (!movedOldPaths.has(c.storage_path)) continue;
    const newPath = plan.get(c.storage_path)?.newPath;
    if (!newPath) continue;
    await sb
      .from("user_creations")
      .update({ storage_path: newPath, media_url: publicUrlFor(supabaseUrl, newPath) })
      .eq("id", c.id);
  }

  for (const s of storyboards ?? []) {
    const patch = {};
    const imgOld = pathFromPublicUrl(s.storyboard_url);
    const vidOld = pathFromPublicUrl(s.video_url);
    if (imgOld && movedOldPaths.has(imgOld) && plan.get(imgOld)) {
      patch.storyboard_url = publicUrlFor(supabaseUrl, plan.get(imgOld).newPath);
    }
    if (vidOld && movedOldPaths.has(vidOld) && plan.get(vidOld)) {
      patch.video_url = publicUrlFor(supabaseUrl, plan.get(vidOld).newPath);
    }
    if (Object.keys(patch).length) {
      await sb.from("storyboards").update(patch).eq("id", s.id);
    }
  }

  for (const p of posts ?? []) {
    const oldPath = pathFromPublicUrl(p.video_url);
    if (!oldPath || !movedOldPaths.has(oldPath)) continue;
    const newPath = plan.get(oldPath)?.newPath;
    if (!newPath) continue;
    await sb.from("posts").update({ video_url: publicUrlFor(supabaseUrl, newPath) }).eq("id", p.id);
  }

  if (deleteGlobalTemp && uniqueGlobalTemp.length) {
    const { error } = await sb.storage.from(BUCKET).remove(uniqueGlobalTemp);
    if (error) throw new Error(`remove global temp: ${error.message}`);
    for (const p of uniqueGlobalTemp) console.log(`[deleted-global-temp] ${p}`);
  }

  if (pruneStaleDb && staleDb.length) {
    for (const row of staleDb) {
      if (row.table === "user_creations") {
        await sb.from("user_creations").delete().eq("id", row.id);
        console.log(`[pruned] user_creations ${row.id}`);
      } else if (row.table === "assets") {
        await sb
          .from("assets")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", row.id);
        console.log(`[soft-deleted] assets ${row.id}`);
      }
    }
  }

  console.log(`\nDone: ${moved} moved, ${skipped} skipped (missing in storage).\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
