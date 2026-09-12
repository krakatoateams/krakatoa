import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

type RouteContract = {
  readonly path: string;
  readonly hashEnd: string;
};

const routeContracts: RouteContract[] = [
  {
    path: "../app/api/generate-video/route.ts",
    hashEnd: "const requiredCredits",
  },
  {
    path: "../app/api/generate-photo/route.ts",
    hashEnd: "const perImageCredits",
  },
  {
    path: "../app/api/generate-reels/route.ts",
    hashEnd: "const jobInput",
  },
  {
    path: "../app/api/generate-storyboard-video/route.ts",
    hashEnd: "const pricingKey",
  },
  {
    path: "../app/api/generate-motion-control/route.ts",
    hashEnd: "executionBackend =",
  },
  {
    path: "./photo-storyboard-generation.ts",
    hashEnd: "const requiredCredits",
  },
];

for (const contract of routeContracts) {
  const source = readFileSync(new URL(contract.path, import.meta.url), "utf8");
  const parsedAt = source.search(
    /const devBlank = (?:isDevBlank(?:Requested|FormValue)|parsed\.devBlank)/,
  );
  const gatedAt = source.indexOf("await requireDevBlankAccess()", parsedAt);
  const hashAt = source.indexOf("const requestHash = computeRequestHash", gatedAt);
  const hashEndAt = source.indexOf(contract.hashEnd, hashAt);

  assert.ok(parsedAt >= 0, `${contract.path} must parse the dev-blank request flag`);
  assert.ok(
    gatedAt > parsedAt,
    `${contract.path} must authorize dev-blank before generation work`,
  );
  assert.ok(hashAt > gatedAt, `${contract.path} must hash after dev-blank authorization`);
  assert.ok(hashEndAt > hashAt, `${contract.path} request-hash boundary must be detectable`);
  assert.match(
    source.slice(hashAt, hashEndAt),
    /\bdevBlank\b/,
    `${contract.path} must include devBlank in its server idempotency hash`,
  );
}

for (const expectation of [
  { path: "../app/api/generate-video/route.ts", provider: 3, model: 3 },
  { path: "../app/api/generate-photo/route.ts", provider: 3, model: 3 },
  { path: "../app/api/generate-reels/route.ts", provider: 2, model: 2 },
  { path: "../app/api/generate-storyboard-video/route.ts", provider: 3, model: 3 },
  {
    path: "../app/api/generate-motion-control/route.ts",
    provider: 5,
    model: 3,
    providerModel: 3,
  },
  { path: "./photo-storyboard-generation.ts", provider: 3, model: 3 },
]) {
  const source = readFileSync(new URL(expectation.path, import.meta.url), "utf8");
  const providerTags = source.match(/provider: devBlank \? "dev_blank"/g)?.length ?? 0;
  const modelTags = source.match(/model: devBlank \? "dev_blank"/g)?.length ?? 0;
  const providerModelTags =
    source.match(/providerModel: devBlank \? "dev_blank"/g)?.length ?? 0;

  assert.ok(
    providerTags >= expectation.provider,
    `${expectation.path} must tag dev-blank provider metadata consistently`,
  );
  assert.ok(
    modelTags >= expectation.model,
    `${expectation.path} must tag dev-blank model metadata consistently`,
  );
  if (expectation.providerModel !== undefined) {
    assert.ok(
      providerModelTags >= expectation.providerModel,
      `${expectation.path} must tag persisted dev-blank providerModel fields`,
    );
  }
}

for (const clientPath of [
  "../app/(app)/tools/video/VideoStudioShell.tsx",
  "../app/(app)/tools/photo-v2/page.tsx",
]) {
  const source = readFileSync(new URL(clientPath, import.meta.url), "utf8");
  assert.match(
    source,
    /if \(!nextIsAdmin\) setDevBlank\(false\)/,
    `${clientPath} must clear hidden blank mode when admin access is lost`,
  );
}

const devBlankCore = readFileSync(
  new URL("./dev-blank-generation.ts", import.meta.url),
  "utf8",
);
assert.match(
  devBlankCore,
  /\[DEV_BLANK_REQUEST_KEY\] === true/,
  "JSON dev-blank parsing must require the literal boolean true",
);
assert.match(
  devBlankCore,
  /return value === "true"/,
  "multipart dev-blank parsing must require the literal string true",
);

console.log("dev-blank generation self-check passed");
