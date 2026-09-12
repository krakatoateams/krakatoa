import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { errorLogSafe } from "./error-log-safe";

const signed =
  "https://example.supabase.co/storage/v1/object/sign/krakatoa/u1/video.mp4?token=secret-jwt&x=1";
const error = new Error(
  `provider failed for ${signed}; Authorization: Bearer oauth-secret; access_token=another-secret`
);
error.stack = `${error.message}\n    at sensitiveFunction (/srv/private.ts:10:2)`;

const safe = errorLogSafe(error);
assert.ok(safe.includes("provider failed"), "the operational reason must remain");
for (const secret of [
  "secret-jwt",
  "oauth-secret",
  "another-secret",
  "sensitiveFunction",
  "/srv/private.ts",
]) {
  assert.ok(!safe.includes(secret), `log output leaked ${secret}`);
}
assert.ok(
  safe.includes("/object/sign/krakatoa/u1/video.mp4"),
  "redaction should retain the useful object path"
);
assert.ok(
  !errorLogSafe("u1/video.mp4?token=relative-secret").includes(
    "relative-secret"
  ),
  "scheme-less signed path tokens must also be redacted"
);
const credentialShapes = errorLogSafe(
  'line one\nAuthorization: Basic dXNlcjpwYXNz Basic c3RhbmRhbG9uZTpzZWNyZXQ= Invalid JWT: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZWNyZXQifQ.sig client_secret=third-secret password=fourth-secret {"access_token":"json-secret"}'
);
assert.ok(!credentialShapes.includes("\n"), "safe errors must stay on one log line");
for (const secret of [
  "dXNlcjpwYXNz",
  "c3RhbmRhbG9uZTpzZWNyZXQ=",
  "eyJhbGciOiJIUzI1NiJ9",
  "third-secret",
  "fourth-secret",
  "json-secret",
]) {
  assert.ok(!credentialShapes.includes(secret), `credential shape leaked ${secret}`);
}

for (const relativePath of [
  "./admin-api.ts",
  "./admin-users-db.ts",
  "./creation-expiry.ts",
  "./expiry-settings-db.ts",
  "./post-storage-cleanup.ts",
  "./skill-configs-db.ts",
  "./storage-sweep.ts",
  "../app/api/admin/me/route.ts",
  "../app/api/admin/skills/route.ts",
  "../app/api/admin/skills/[skillId]/thumb/route.ts",
  "../app/api/cron/creation-expiry/route.ts",
  "../app/api/cron/credit-expiry/route.ts",
  "../app/api/cron/generation-reconcile/route.ts",
  "../app/api/cron/storage-sweep/route.ts",
  "../app/api/cron/cleanup-failed-posts/route.ts",
]) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  assert.match(
    source,
    /errorLogSafe/,
    `${relativePath} must redact unexpected operational errors`
  );
}

for (const relativePath of [
  "../app/api/cron/creation-expiry/route.ts",
  "../app/api/cron/credit-expiry/route.ts",
  "../app/api/cron/generation-reconcile/route.ts",
  "../app/api/cron/storage-sweep/route.ts",
  "../app/api/cron/cleanup-failed-posts/route.ts",
]) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  assert.doesNotMatch(
    source,
    /NextResponse\.json\(\{ error: message \}/,
    `${relativePath} must not return internal error text`
  );
}

const reconcileRoute = readFileSync(
  new URL(
    "../app/api/cron/generation-reconcile/route.ts",
    import.meta.url
  ),
  "utf8"
);
assert.match(
  reconcileRoute,
  /errors: result\.errors\.map\(errorLogSafe\)/,
  "non-terminal reconcile errors must be redacted in success responses"
);

const adminSkillDetailRoute = readFileSync(
  new URL(
    "../app/api/admin/skills/[skillId]/route.ts",
    import.meta.url
  ),
  "utf8"
);
assert.doesNotMatch(
  adminSkillDetailRoute,
  /Failed to delete skill[\s\S]*?error: message/,
  "unexpected admin delete failures must reach the generic withAdmin 500 path"
);

console.log("admin log redaction self-check passed");
