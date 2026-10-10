// Sums the files each route's .next/server/**/*.nft.json traces into its
// function bundle. Run after `npm run build`: node scripts/trace-size-report.mjs
// Exits 1 if a route that must skip sharp lists it, or /api/cron lost it.
import fs from "node:fs";
import path from "node:path";

const serverDir = path.join(process.cwd(), ".next", "server");
const NO_SHARP = [
  "api/posts",
  "api/cron/instagram-token-refresh",
  "api/connections/instagram/callback",
  "api/connections/tiktok/start",
  "api/connections/tiktok/callback",
  "api/connections/tiktok/creator-info",
];
const NEEDS_SHARP = ["api/cron"];

function* walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".nft.json")) yield p;
  }
}

function pkgOf(file) {
  const m = file.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/g);
  if (m) return m[m.length - 1].replace("node_modules/", "");
  return file.includes(".next/") ? "(compiled chunks)" : "(other)";
}

const MB = 1024 * 1024;
const routes = new Map();
for (const nft of walk(serverDir)) {
  const { files } = JSON.parse(fs.readFileSync(nft, "utf8"));
  const byPkg = new Map();
  let total = 0;
  for (const f of files) {
    const abs = path.resolve(path.dirname(nft), f);
    let size;
    try {
      size = fs.statSync(abs).size;
    } catch {
      continue;
    }
    if (!fs.statSync(abs).isFile()) continue;
    total += size;
    const pkg = pkgOf(abs.replaceAll(path.sep, "/"));
    byPkg.set(pkg, (byPkg.get(pkg) ?? 0) + size);
  }
  const route = path.relative(serverDir, nft).replace(/(\/route|\/page)?\.js\.nft\.json$/, "").replace(/^app\//, "").replace(/\.nft\.json$/, "");
  routes.set(route, { total, byPkg });
}

let totalBytes = 0;
for (const r of routes.values()) totalBytes += r.total;
console.log(`Entries: ${routes.size}, total of per-entry traced size: ${(totalBytes / MB).toFixed(1)} MB`);

const hasSharp = (r) => [...r.byPkg.keys()].some((k) => k === "sharp" || k.startsWith("@img/"));
const watched = [...NO_SHARP, ...NEEDS_SHARP];
for (const [route, r] of [...routes].sort((a, b) => b[1].total - a[1].total)) {
  if (!watched.includes(route) && r.total < 10 * MB) continue;
  const top = [...r.byPkg].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => `${k} ${(v / MB).toFixed(1)}`).join(", ");
  console.log(`${(r.total / MB).toFixed(1).padStart(6)} MB  ${route}  [${top}]`);
}

let failed = false;
for (const route of NO_SHARP) {
  const r = routes.get(route);
  if (!r) { console.error(`FAIL: no trace found for ${route}`); failed = true; }
  else if (hasSharp(r)) { console.error(`FAIL: ${route} still lists sharp/@img`); failed = true; }
}
for (const route of NEEDS_SHARP) {
  const r = routes.get(route);
  if (!r || !hasSharp(r)) { console.error(`FAIL: ${route} must list sharp`); failed = true; }
}
process.exit(failed ? 1 : 0);
