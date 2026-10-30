/**
 * Guard: provider SDK/client usage stays behind `lib/ai-providers/`. The generate-photo
 * path is migrated; every other caller is on the allowlist below. The allowlist may
 * only shrink: a listed file that no longer violates must be removed (this check fails).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const SCAN_DIRS = ["app", "lib", "scripts", "components"];
const PROVIDER_DIR = "lib/ai-providers/";
const PATTERN =
  /from\s*["'](?:replicate|@fal-ai\/client)["']|import\(\s*["']replicate["']\s*\)|require\(\s*["']replicate["']\s*\)|\bcreateReplicateClient\b|\bpredictions\.|\brunReplicateWithRetry\b|\brunWithRetry\b|replicate-utils|\buploadProductImageToReplicate\b|\bcancelReplicatePredictions\b|\bextractMediaUrl\b/;

/** Self-checks that legitimately name provider APIs. Explicit entries only; never a glob. */
const SELF_CHECK_EXEMPT: readonly string[] = [
  "lib/ai-provider-guard-self-check.ts",
  "lib/client-secret-boundary-self-check.ts",
  "lib/generation-log-redaction-self-check.ts",
];

/** Pin on ALLOWLIST.length: growing the allowlist fails CI until this number is deliberately raised. Lower it when you shrink the list. */
export const ALLOWLIST_MAX = 27;

/** Not yet migrated to the provider seam. Remove entries as paths migrate; never add. */
export const ALLOWLIST: readonly string[] = [
  "app/(app)/admin/monitoring/page.tsx",
  "app/api/generate-canvas-text/route.ts",
  "app/api/generate-caption/route.ts",
  "app/api/generate-motion-control/route.ts",
  "app/api/generate-motion-control/status/route.ts",
  "app/api/generate-reels/route.ts",
  "app/api/generate-storyboard-video/route.ts",
  "app/api/generate-video/route.ts",
  "app/api/generations/cancel/route.ts",
  "app/api/storyboards/import/route.ts",
  "app/api/test-stitch/route.ts",
  "lib/generation-cancel.ts",
  "lib/generation-workflows/motion-control-workflow-core.ts",
  "lib/generation-workflows/replicate-webhook.ts",
  "lib/generation-workflows/submission-recovery-pure.ts",
  "lib/photo-storyboard-generation.ts",
  "lib/reels-helpers.ts",
  "lib/reels-pipeline/llm.ts",
  "lib/reels-pipeline/seedance.ts",
  "lib/reels-pipeline/tts-whisper.ts",
  "lib/reels-pipeline/types.ts",
  "lib/reels-pipeline/veo.ts",
  "lib/replicate-product-image.ts",
  "lib/replicate-server.ts",
  "lib/replicate-utils.ts",
  "scripts/probe-monitoring.ts",
  "scripts/recover-motion-control.ts",
];

/** Pure: files (repo-relative path -> source) -> error messages. */
export function providerGuardErrors(files: Record<string, string>, allow: readonly string[]): string[] {
  const errors: string[] = [];
  const violating = new Set<string>();
  for (const [file, src] of Object.entries(files)) {
    if (file.startsWith(PROVIDER_DIR) || SELF_CHECK_EXEMPT.includes(file)) continue;
    if (PATTERN.test(src)) violating.add(file);
  }
  for (const f of violating) {
    if (!allow.includes(f)) errors.push(`${f}: provider usage outside lib/ai-providers/ (use the seam, do not extend the allowlist)`);
  }
  for (const f of allow) {
    if (!violating.has(f)) errors.push(`${f}: allowlisted but no longer violates; remove it from ALLOWLIST`);
  }
  return errors;
}

/** Retired model slug (exact; `.5-flare` etc. are fine). Migrations and this file are exempt. */
const RETIRED_SLUG = /openai\/gpt-image-2(?![.\-\w])/;

/** Pure: files -> errors for any reintroduced retired slug. */
export function retiredSlugErrors(files: Record<string, string>): string[] {
  return Object.entries(files)
    .filter(([file, src]) => !/ai-provider-guard-self-check\.ts$/.test(file) && RETIRED_SLUG.test(src))
    .map(([file]) => `${file}: retired model slug openai/gpt-image-2 (use openai/gpt-image-2.5-flare)`);
}

function walk(dir: string, out: Record<string, string>): void {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) out[path.relative(ROOT, full)] = readFileSync(full, "utf8");
  }
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`aiProviderGuardSelfCheck: ${msg}`);
}

// The guard must fail on a new violation, and on a stale allowlist entry.
assert(providerGuardErrors({ "app/api/new/route.ts": 'import Replicate from "replicate";' }, []).length === 1, "new SDK import not flagged");
assert(providerGuardErrors({ "lib/x.ts": "createReplicateClient()" }, []).length === 1, "createReplicateClient not flagged");
assert(providerGuardErrors({ "app/api/x/route.ts": 'import { fal } from "@fal-ai/client";' }, []).length === 1, "Fal SDK import not flagged");
assert(providerGuardErrors({ "lib/ai-providers/a.ts": "createReplicateClient()" }, []).length === 0, "provider dir must be exempt");
assert(providerGuardErrors({ "lib/x.ts": "const a = 1;" }, ["lib/x.ts"]).length === 1, "stale allowlist entry not flagged");
assert(providerGuardErrors({ "lib/foo-self-check.ts": "createReplicateClient()" }, []).length === 1, "self-check files must not be blanket-exempt");
assert(providerGuardErrors({ "components/a.tsx": 'import { extractMediaUrl } from "@/lib/x";' }, []).length === 1, "extractMediaUrl not flagged");
assert(providerGuardErrors({ "lib/a.mjs": 'import x from "./replicate-utils";' }, []).length === 1, "replicate-utils import not flagged");
assert(providerGuardErrors({ "lib/a.ts": "uploadProductImageToReplicate(r, f)" }, []).length === 1, "uploadProductImageToReplicate not flagged");
assert(providerGuardErrors({ "lib/a.ts": "cancelReplicatePredictions(r, ids)" }, []).length === 1, "cancelReplicatePredictions not flagged");

assert(retiredSlugErrors({ "lib/x.ts": '"openai/gpt-image-2"' }).length === 1, "retired slug not flagged");
assert(retiredSlugErrors({ "lib/x.ts": '"openai/gpt-image-2.5-flare"' }).length === 0, "flare slug wrongly flagged");

const files: Record<string, string> = {};
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), files);
assert(ALLOWLIST.length <= ALLOWLIST_MAX, `ALLOWLIST has ${ALLOWLIST.length} entries but is pinned at ${ALLOWLIST_MAX}; the allowlist may only shrink`);
const errors = providerGuardErrors(files, ALLOWLIST);
assert(errors.length === 0, `\n${errors.join("\n")}`);
const slugErrors = retiredSlugErrors(files);
assert(slugErrors.length === 0, `\n${slugErrors.join("\n")}`);
console.log("ai-provider-guard-self-check: ok");
