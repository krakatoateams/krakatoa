/**
 * Provider selection and R2 presign windows. No credentials and no network.
 * Self-check: `npx tsx lib/media-storage-pure.ts`.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export type MediaWriteProvider = "supabase" | "r2";

/** SigV4 presigned URLs cannot outlive 7 days. UI reads ask for 30. */
export const R2_MAX_PRESIGN_SEC = 7 * 24 * 60 * 60;

const DAY_SEC = 24 * 60 * 60;

export function mediaWriteProvider(env: Record<string, string | undefined>): MediaWriteProvider {
  const raw = (env.MEDIA_STORAGE_PROVIDER ?? "supabase").trim().toLowerCase();
  if (raw === "" || raw === "supabase") return "supabase";
  if (raw === "r2") return "r2";
  throw new Error("MEDIA_STORAGE_PROVIDER must be supabase or r2.");
}

export function r2Configured(env: Record<string, string | undefined>): boolean {
  return Boolean(
    env.R2_ACCOUNT_ID?.trim() &&
      env.R2_ACCESS_KEY_ID?.trim() &&
      env.R2_SECRET_ACCESS_KEY?.trim() &&
      env.R2_BUCKET?.trim(),
  );
}

/** Folder inside the bucket. Empty means objects sit at the bucket root. */
export function r2KeyPrefix(env: Record<string, string | undefined>): string {
  return (env.R2_KEY_PREFIX ?? "").trim().replace(/^\/+|\/+$/g, "");
}

/** App path `{userId}/photos/…` becomes `user-generations/{userId}/photos/…` when a prefix is set. */
export function r2ObjectKey(prefix: string, path: string): string {
  const clean = path.replace(/^\/+/, "");
  return prefix ? (clean ? `${prefix}/${clean}` : `${prefix}/`) : clean;
}

/** Undo `r2ObjectKey`. Keys outside the prefix are ignored so other folders stay untouched. */
export function logicalKeyFromR2(prefix: string, key: string): string | null {
  if (!prefix) return key;
  const root = `${prefix}/`;
  if (key === prefix || key === root) return "";
  if (!key.startsWith(root)) return null;
  return key.slice(root.length);
}

/** Cloudflare account ids are 32 hex characters. Anything else is ignored. */
export function r2BrowserOrigin(accountId: string | undefined): string | null {
  const id = accountId?.trim() ?? "";
  if (!/^[a-f0-9]{32}$/i.test(id)) return null;
  return `https://${id}.r2.cloudflarestorage.com`;
}

/** supabase-js sends a bare number as `max-age=<value>` and leaves a full directive alone. */
export function cacheControlHeader(value: string): string {
  const trimmed = value.trim();
  if (/max-age=/i.test(trimmed)) return trimmed;
  return `max-age=${trimmed}`;
}

function amzDate(unixSec: number): string {
  return new Date(unixSec * 1000).toISOString().replace(/[:-]|\.\d{3}/g, "");
}

/**
 * A presign whose query string stays the same for the whole window.
 * Long TTLs are capped at 7 days and bucketed by the day, so a cache miss
 * later the same day still mints the URL the browser already has.
 */
export function presignPlan(
  nowMs: number,
  ttlSec: number,
): { datetime: string; expiresSec: number; validForSec: number } {
  const ttl = Math.max(1, Math.floor(ttlSec));
  const nowSec = Math.floor(nowMs / 1000);
  if (ttl > R2_MAX_PRESIGN_SEC) {
    const start = Math.floor(nowSec / DAY_SEC) * DAY_SEC;
    const validForSec = Math.max(1, start + R2_MAX_PRESIGN_SEC - nowSec);
    return { datetime: amzDate(start), expiresSec: R2_MAX_PRESIGN_SEC, validForSec };
  }
  const start = Math.floor(nowSec / ttl) * ttl;
  const expiresSec = Math.min(R2_MAX_PRESIGN_SEC, ttl * 2);
  const validForSec = Math.max(1, start + expiresSec - nowSec);
  return { datetime: amzDate(start), expiresSec, validForSec };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`media-storage-pure: ${message}`);
}

export function mediaStoragePureSelfCheck(): void {
  assert(mediaWriteProvider({}) === "supabase", "default provider is supabase");
  assert(mediaWriteProvider({ MEDIA_STORAGE_PROVIDER: "r2" }) === "r2", "r2 provider");
  assert(!r2Configured({ R2_ACCOUNT_ID: "abc" }), "r2 needs every credential");
  assert(
    r2Configured({
      R2_ACCOUNT_ID: "a",
      R2_ACCESS_KEY_ID: "b",
      R2_SECRET_ACCESS_KEY: "c",
      R2_BUCKET: "d",
    }),
    "r2 configured",
  );
  assert(r2BrowserOrigin("not-an-id") === null, "reject a non-account host");
  assert(
    r2BrowserOrigin("0123456789abcdef0123456789abcdef") ===
      "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    "r2 origin",
  );
  assert(r2KeyPrefix({}) === "" && r2KeyPrefix({ R2_KEY_PREFIX: "/user-generations/" }) === "user-generations", "prefix is trimmed");
  assert(r2ObjectKey("user-generations", "user/photos/a.png") === "user-generations/user/photos/a.png", "prefix joins the app path");
  assert(r2ObjectKey("", "user/photos/a.png") === "user/photos/a.png", "no prefix keeps the app path");
  assert(logicalKeyFromR2("user-generations", "user-generations/user/photos/a.png") === "user/photos/a.png", "listed keys drop the folder");
  assert(logicalKeyFromR2("user-generations", "Product review/banner.mp4") === null, "other folders are not app objects");
  assert(cacheControlHeader("3600") === "max-age=3600", "bare cache control");
  assert(
    cacheControlHeader("31536000, immutable") === "max-age=31536000, immutable",
    "immutable cache control",
  );

  const noon = Date.parse("2026-10-30T12:00:00Z");
  const later = Date.parse("2026-10-30T18:00:00Z");
  const longA = presignPlan(noon, 2592000);
  const longB = presignPlan(later, 2592000);
  assert(longA.datetime === longB.datetime && longA.expiresSec === R2_MAX_PRESIGN_SEC, "ui window is stable for a day");
  assert(longA.validForSec > longB.validForSec, "later in the day has less life left");
  const nextDay = presignPlan(Date.parse("2026-10-31T01:00:00Z"), 2592000);
  assert(nextDay.datetime !== longA.datetime, "the next day starts a new window");

  const shortA = presignPlan(noon, 900);
  const shortB = presignPlan(noon + 60_000, 900);
  assert(shortA.datetime === shortB.datetime && shortA.expiresSec === 1800, "short ttl buckets and doubles");

  const root = path.join(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js)$/.test(name)) files.push(full);
    }
  };
  for (const dir of ["app", "lib", "components", "scripts"]) walk(path.join(root, dir));
  for (const file of files) {
    const rel = path.relative(root, file);
    if (rel === "lib/media-storage.ts") continue;
    if (/^scripts\/migrate-storage-.*\.mjs$/.test(rel)) continue;
    const source = readFileSync(file, "utf8");
    const signer = "aws4" + "fetch";
    const direct = ".storage" + ".from(";
    assert(!source.includes(signer), `${rel} must not import the S3 signer`);
    assert(!source.includes(direct), `${rel} must not call storage directly`);
  }
}

if (require.main === module) {
  mediaStoragePureSelfCheck();
  console.log("mediaStoragePureSelfCheck: ok");
}
