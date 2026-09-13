import assert from "node:assert/strict";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string): string =>
  readFileSync(path.join(root, relativePath), "utf8");

const retiredSetupSurfaces = [
  "app/api/dev/setup-db/route.ts",
  "app/api/dev/setup-product-photo-table/route.ts",
  "lib/supabase-migrate.ts",
];

for (const relativePath of retiredSetupSurfaces) {
  assert.equal(
    existsSync(path.join(root, relativePath)),
    false,
    `${relativePath} must stay retired; database setup uses MCP or local CLI`,
  );
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const absolute = path.join(directory, name);
    if (statSync(absolute).isDirectory()) return sourceFiles(absolute);
    return /\.(?:ts|tsx)$/.test(name) ? [absolute] : [];
  });
}

const devApiDirectory = path.join(root, "app/api/dev");
assert.deepEqual(
  existsSync(devApiDirectory) ? sourceFiles(devApiDirectory) : [],
  [],
  "new /api/dev route source requires an explicit security review before deployment",
);

const appFiles = sourceFiles(path.join(root, "app"));
assert.deepEqual(
  appFiles.filter((file) =>
    /[/\\]app[/\\]api[/\\].*setup.*[/\\]route\.ts$/.test(file),
  ),
  [],
  "database setup must not be exposed from any deployed API route path",
);

const deployableSource = [
  ...appFiles,
  ...sourceFiles(path.join(root, "lib")).filter(
    (file) => path.basename(file) !== "internal-route-obscurity-self-check.ts",
  ),
]
  .map((file) => readFileSync(file, "utf8"))
  .join("\n");
assert.doesNotMatch(
  deployableSource,
  /SUPABASE_ACCESS_TOKEN|SETUP_DB_KEY|api\.supabase\.com\/v1\/projects/,
  "deployable source must not contain dormant Supabase Management API setup access",
);

for (const hintPath of [
  "lib/creations-db.ts",
  "lib/feature-model-configs-db.ts",
]) {
  assert.doesNotMatch(
    read(hintPath),
    /\/api\/dev\/setup-(?:db|product-photo-table)/,
    `${hintPath} must not direct operators to a retired HTTP setup route`,
  );
}

const designSystemLayout = read("app/(internal)/design-system/layout.tsx");
assert.match(
  designSystemLayout,
  /process\.env\.NODE_ENV === "production"/,
  "the internal design system must fail closed in production builds",
);
assert.match(
  designSystemLayout,
  /notFound\(\)/,
  "the internal design system must use a production 404",
);

const testStitch = read("app/api/test-stitch/route.ts");
assert.match(
  testStitch,
  /export async function POST\(/,
  "the operator stitch utility must remain mutation-only POST",
);
assert.match(
  testStitch,
  /return withAdmin\(/,
  "the production stitch utility must remain admin-gated",
);
assert.doesNotMatch(
  testStitch,
  /export async function GET\(/,
  "the production stitch utility must not expose mutation work through GET",
);

const devBlank = read("lib/dev-blank-generation.ts");
assert.match(
  devBlank,
  /export async function requireDevBlankAccess\(/,
  "blank generation must keep its server-side admin gate",
);

const publicDevFiles = readdirSync(path.join(root, "public/dev")).sort();
assert.deepEqual(
  publicDevFiles,
  [
    "blank-video-16x9.mp4",
    "blank-video-1x1.mp4",
    "blank-video-3x4.mp4",
    "blank-video-4x3.mp4",
    "blank-video.mp4",
    "blank.png",
  ],
  "public/dev must contain only the reviewed non-sensitive blank placeholders",
);

console.log("internal route obscurity self-check passed");
