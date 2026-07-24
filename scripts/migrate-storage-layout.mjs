/**
 * One-off: move legacy Supabase Storage objects into the canonical per-user layout
 * and update DB URLs/paths (assets, user_creations, storyboards, posts).
 *
 *   node scripts/migrate-storage-layout.mjs           # dry-run (default)
 *   node scripts/migrate-storage-layout.mjs --execute # apply moves + DB updates
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET ?? "krakatoa";
const PHOTO_MODES = new Set(["product", "t2i", "character", "storyboard"]);
const VIDEO_MODES = new Set(["reelscreator", "t2v", "i2v", "motion-control"]);

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

function safeUserId(id) {
  const safe = String(id || "").replace(/[^a-zA-Z0-9-]/g, "");
  if (!safe) return null;
  return safe;
}

function basename(path) {
  return path.split("/").pop() || path;
}

function pathFromPublicUrl(url, supabaseUrl) {
  if (!url) return null;
  const marker = `/object/public/${BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx !== -1) return decodeURIComponent(url.slice(idx + marker.length));
  // legacy wrong bucket in some rows
  const legacy = `/object/public/videos/`;
  const li = url.indexOf(legacy);
  if (li !== -1) return null; // different bucket — skip
  return null;
}

function publicUrlFor(supabaseUrl, storagePath) {
  const encoded = storagePath
    .split("/")
    .map((s) => encodeURIComponent(s).replace(/%2F/g, "/"))
    .join("/");
  return `${supabaseUrl}/storage/v1/object/public/${BUCKET}/${encoded}`;
}

function isCanonicalPath(path) {
  if (!path) return true;
  if (/^photos\/[^/]+\/generated\/(product|t2i|character|storyboard)\/[^/]+$/.test(path))
    return true;
  if (/^photos\/[^/]+\/uploads\/reference\/[^/]+$/.test(path)) return true;
  if (
    /^videos\/[^/]+\/generated\/video\/(reelscreator|t2v|i2v|motion-control)\/[^/]+$/.test(
      path,
    )
  )
    return true;
  if (/^videos\/[^/]+\/generated\/storyboard\/[^/]+$/.test(path)) return true;
  if (/^videos\/[^/]+\/uploads\/scheduler\/[^/]+$/.test(path)) return true;
  if (/^videos\/[^/]+\/(temp|uploads)\//.test(path)) return true;
  return false;
}

function isTransientPath(path) {
  return /\/temp\//.test(path) || path.startsWith("videos/temp/");
}

function photoModeFromMeta({ tool, role, kind, filename }) {
  if (kind === "character") return "character";
  if (tool === "storyboard" || role === "storyboard_image") return "storyboard";
  if (/__auto__auto|__\w+__auto\./i.test(filename)) return "t2i";
  return "product";
}

function videoModeFromMeta({ tool, role, filename }) {
  if (tool === "storyboard_video" || (tool === "storyboard" && role === "final_video"))
    return "__storyboard_video__";
  if (role === "final_video" || /^reels_/i.test(filename)) return "reelscreator";
  if (role === "video_motion_control" || tool === "video_motion_control" || /^motion_/i.test(filename))
    return "motion-control";
  if (role === "video_image2video" || tool === "video_image2video") return "i2v";
  if (role === "video_text2video" || tool === "video_text2video") return "t2v";
  if (tool === "reels" || tool === "reels_seedance" || tool === "reels_veo") return "reelscreator";
  if (/^video_/i.test(filename)) return "t2v"; // ponytail: legacy flat name fallback
  return "reelscreator";
}

function isSchedulerDeviceUpload(path) {
  return /^videos\/\d+-[^/]+$/.test(path);
}

function targetPath(oldPath, ctx) {
  const { userId, tool, role, kind } = ctx;
  const uid = safeUserId(userId);
  if (!uid) return null;
  const file = basename(oldPath);

  // photos/{uid}/generated/{file} (flat legacy)
  const flatPhoto = oldPath.match(/^photos\/[^/]+\/generated\/([^/]+)$/);
  if (flatPhoto) {
    const mode = photoModeFromMeta({ tool, role, kind, filename: file });
    return `photos/${uid}/generated/${mode}/${file}`;
  }

  // photos/{uid}/uploads/{file} → reference/
  const flatUpload = oldPath.match(/^photos\/[^/]+\/uploads\/([^/]+)$/);
  if (flatUpload && !oldPath.includes("/uploads/reference/")) {
    return `photos/${uid}/uploads/reference/${file}`;
  }

  // global videos/storyboard/*
  if (oldPath.startsWith("videos/storyboard/")) {
    if (/\.(png|jpg|jpeg|webp)$/i.test(file)) {
      return `photos/${uid}/generated/storyboard/${file}`;
    }
    if (/\.mp4$/i.test(file)) {
      return `videos/${uid}/generated/storyboard/${file}`;
    }
  }

  // flat generation videos: videos/reels_*, videos/video_*, videos/motion_*
  if (/^videos\/(reels_|video_|motion_)/.test(oldPath)) {
    const mode = videoModeFromMeta({ tool, role, filename: file });
    if (mode === "__storyboard_video__") {
      return `videos/${uid}/generated/storyboard/${file}`;
    }
    return `videos/${uid}/generated/video/${mode}/${file}`;
  }

  // scheduler device upload
  if (isSchedulerDeviceUpload(oldPath)) {
    return `videos/${uid}/uploads/scheduler/${file}`;
  }

  return null;
}

/** @typedef {{ userId?: string, tool?: string, role?: string, kind?: string }} PathCtx */

/** @param {PathCtx[]} contexts */
function resolveTarget(oldPath, contexts) {
  const userId =
    contexts.map((c) => safeUserId(c.userId)).find(Boolean) ?? null;
  if (!userId) return null;

  const merged = {
    userId,
    tool: contexts.find((c) => c.tool)?.tool ?? null,
    role: contexts.find((c) => c.role)?.role ?? null,
    kind: contexts.find((c) => c.kind)?.kind ?? null,
  };
  // creationKind=character beats product for the same file
  if (contexts.some((c) => c.kind === "character")) merged.kind = "character";

  return targetPath(oldPath, merged);
}

/** @param {Map<string, { contexts: PathCtx[], sources: string[] }>} plan */
function addContext(plan, oldPath, ctx, source) {
  if (!oldPath || isCanonicalPath(oldPath) || isTransientPath(oldPath)) return;
  let entry = plan.get(oldPath);
  if (!entry) {
    entry = { contexts: [], sources: [] };
    plan.set(oldPath, entry);
  }
  entry.contexts.push(ctx);
  entry.sources.push(source);
}

async function main() {
  const execute = process.argv.includes("--execute");
  const env = loadEnv();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const sb = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: profiles, error: pErr } = await sb.from("profiles").select("id, user_id");
  if (pErr) throw pErr;
  const profileToUser = new Map(profiles.map((p) => [p.id, p.user_id]));

  /** @type {Map<string, { contexts: PathCtx[], sources: string[] }>} */
  const raw = new Map();

  const ingest = (storagePath, ctx, source) => {
    addContext(raw, storagePath, ctx, source);
  };

  const { data: assets } = await sb
    .from("assets")
    .select("id, storage_path, profile_id, tool, role, metadata")
    .not("storage_path", "is", null)
    .is("deleted_at", null);

  for (const a of assets ?? []) {
    const userId = profileToUser.get(a.profile_id);
    ingest(a.storage_path, {
      userId,
      tool: a.tool,
      role: a.role,
      kind: a.metadata?.creationKind,
    }, `assets:${a.id}`);
  }

  const { data: creations } = await sb
    .from("user_creations")
    .select("id, user_id, storage_path, tool, metadata")
    .neq("storage_path", "");

  for (const c of creations ?? []) {
    ingest(c.storage_path, {
      userId: c.user_id,
      tool: c.tool,
      role: null,
      kind: c.metadata?.creationKind,
    }, `user_creations:${c.id}`);
  }

  const { data: storyboards } = await sb
    .from("storyboards")
    .select("id, user_id, storyboard_url, video_url");

  for (const s of storyboards ?? []) {
    const ctx = { userId: s.user_id, tool: "storyboard", role: null, kind: null };
    const img = pathFromPublicUrl(s.storyboard_url, supabaseUrl);
    if (img) ingest(img, { ...ctx, role: "storyboard_image" }, `storyboards.img:${s.id}`);
    const vid = pathFromPublicUrl(s.video_url, supabaseUrl);
    if (vid)
      ingest(
        vid,
        { ...ctx, tool: "storyboard_video", role: "final_video" },
        `storyboards.vid:${s.id}`,
      );
  }

  const { data: posts } = await sb
    .from("posts")
    .select("id, user_id, profile_id, video_url")
    .not("video_url", "is", null);

  for (const p of posts ?? []) {
    const path = pathFromPublicUrl(p.video_url, supabaseUrl);
    if (!path) continue;
    const userId = p.user_id || profileToUser.get(p.profile_id);
    // Infer mode from filename when no asset link
    ingest(path, { userId, tool: null, role: null, kind: null }, `posts:${p.id}`);
  }

  /** @type {Map<string, { oldPath: string, newPath: string, sources: string[] }>} */
  const plan = new Map();
  for (const [oldPath, { contexts, sources }] of raw) {
    const newPath = resolveTarget(oldPath, contexts);
    if (!newPath || newPath === oldPath) continue;
    plan.set(oldPath, { oldPath, newPath, sources });
  }

  const moves = [...plan.values()].sort((a, b) => a.oldPath.localeCompare(b.oldPath));
  console.log(`\n${execute ? "EXECUTE" : "DRY-RUN"}: ${moves.length} storage move(s)\n`);
  for (const m of moves) {
    console.log(`  ${m.oldPath}`);
    console.log(`    → ${m.newPath}`);
    console.log(`    (${m.sources.join(", ")})\n`);
  }

  if (!execute) {
    console.log("Re-run with --execute to apply.\n");
    return;
  }

  const urlMap = new Map();
  for (const m of moves) {
    urlMap.set(m.oldPath, m.newPath);
    urlMap.set(encodeURI(m.oldPath), m.newPath);
  }

  let moved = 0;
  let skipped = 0;
  /** @type {Set<string>} */
  const movedOldPaths = new Set();
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

  function replaceUrl(url) {
    if (!url) return url;
    const oldPath = pathFromPublicUrl(url, supabaseUrl);
    if (!oldPath) return url;
    const newPath = plan.get(oldPath)?.newPath;
    if (!newPath) return url;
    return publicUrlFor(supabaseUrl, newPath);
  }

  // assets — only rows whose storage object actually moved
  for (const a of assets ?? []) {
    if (!movedOldPaths.has(a.storage_path)) continue;
    const newPath = plan.get(a.storage_path)?.newPath;
    if (!newPath) continue;
    await sb
      .from("assets")
      .update({
        storage_path: newPath,
        public_url: publicUrlFor(supabaseUrl, newPath),
      })
      .eq("id", a.id);
  }

  // user_creations
  for (const c of creations ?? []) {
    if (!movedOldPaths.has(c.storage_path)) continue;
    const newPath = plan.get(c.storage_path)?.newPath;
    if (!newPath) continue;
    await sb
      .from("user_creations")
      .update({
        storage_path: newPath,
        media_url: publicUrlFor(supabaseUrl, newPath),
      })
      .eq("id", c.id);
  }

  // storyboards
  for (const s of storyboards ?? []) {
    const patch = {};
    const imgOld = pathFromPublicUrl(s.storyboard_url, supabaseUrl);
    const vidOld = pathFromPublicUrl(s.video_url, supabaseUrl);
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

  // posts
  for (const p of posts ?? []) {
    const oldPath = pathFromPublicUrl(p.video_url, supabaseUrl);
    if (!oldPath || !movedOldPaths.has(oldPath)) continue;
    const newUrl = replaceUrl(p.video_url);
    if (newUrl !== p.video_url) {
      await sb.from("posts").update({ video_url: newUrl }).eq("id", p.id);
    }
  }

  console.log(`\nDone: ${moved} moved, ${skipped} skipped (missing in storage).\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
