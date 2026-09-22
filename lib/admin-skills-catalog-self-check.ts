import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SkillConfigOverride } from "./skill-configs-db";
import { getSkill, skillPinMismatch } from "./skills";

async function main(): Promise<void> {
  process.env.NEXT_PUBLIC_SUPABASE_URL ||= "http://127.0.0.1:54321";
  process.env.SUPABASE_SERVICE_ROLE_KEY ||= "self-check-service-role";
  const { mergeSkill, parseSkillInputs } = await import("./skill-configs-db");

const welcome = getSkill("welcome-video");
assert.ok(welcome?.modelId, "welcome-video must retain its code model pin");
assert.equal(welcome.duration, 5, "welcome-video must pin its 10-credit duration");

const emptyOverlay: SkillConfigOverride = {
  skillId: "welcome-video",
  title: "Edited title",
  description: null,
  promptPlaceholder: null,
  recipe: null,
  thumbPath: null,
  category: null,
  badge: null,
  promptRequired: null,
  origin: "overlay",
  mediaType: "video",
  inputs: null,
  icon: null,
  hidden: false,
  ownerProfileId: null,
  modelId: null,
  duration: null,
  resolution: null,
  aspectRatio: null,
};
assert.equal(
  mergeSkill(welcome, emptyOverlay).modelId,
  welcome.modelId,
  "an unrelated overlay must inherit the code-catalog model pin"
);
assert.equal(
  mergeSkill(welcome, { ...emptyOverlay, modelId: "kling_v3" }).modelId,
  "kling_v3",
  "an explicit admin model pin must override the catalog pin"
);

assert.equal(skillPinMismatch("kling_v3", "seedance2mini", true), true);
assert.equal(
  skillPinMismatch("kling_v3", "seedance2mini", false),
  false,
  "a disabled designation may fall back to an enabled model"
);
assert.equal(skillPinMismatch(undefined, "seedance2mini", true), false);
assert.equal(
  parseSkillInputs(
    [
      { key: "subject", required: true },
      { key: "scene", required: true },
    ],
    "image"
  ),
  null,
  "subject cannot be mixed with product-mode scene inputs"
);
assert.ok(
  parseSkillInputs(
    [
      { key: "scene", required: true },
      { key: "character", required: true },
    ],
    "image"
  ),
  "the supported scene+character product-mode pair must remain valid"
);
assert.equal(
  parseSkillInputs([{ key: "scene", required: false }], "image"),
  null,
  "scene selects product mode and therefore cannot be optional"
);

const photoRoute = readFileSync(
  new URL("../app/api/generate-photo/route.ts", import.meta.url),
  "utf8"
);
assert.match(
  photoRoute,
  /hasRequiredCharacterReference/,
  "photo skills must validate character-only references independently of product mode"
);
assert.doesNotMatch(
  photoRoute,
  /slot\.key === "character" && slot\.required\) &&\s*!hasCharacterReference/,
  "required character validation must not use the product-only reference flag"
);
assert.match(photoRoute, /skillPinMismatch/);

const videoRoute = readFileSync(
  new URL("../app/api/generate-video/route.ts", import.meta.url),
  "utf8"
);
assert.match(videoRoute, /skillPinMismatch/);
assert.match(
  videoRoute,
  /liveSkill\.duration !== duration/,
  "code-catalog duration pins must be enforced before spend"
);

const composerSource = readFileSync(
  new URL(
    "../app/(app)/tools/skills/SkillComposer.tsx",
    import.meta.url
  ),
  "utf8"
);
assert.match(
  composerSource,
  /\/api\/tools\/photo\/features/,
  "photo skill choices must track admin-enabled feature models"
);
assert.match(
  composerSource,
  /photoEnablement\[photoMode\]\?\.includes\(tier\.id\)/,
  "disabled designated photo models must not lock the composer"
);
assert.match(
  composerSource,
  /photoMode === "product" \|\|/,
  "product-mode skills must only offer reference-capable tiers"
);

const configsSource = readFileSync(
  new URL("./skill-configs-db.ts", import.meta.url),
  "utf8"
);
assert.match(configsSource, /replaceCatalogSkillThumb/);
assert.match(configsSource, /replaceOwnedSkillThumb/);
assert.match(
  configsSource,
  /if \(patch\.revert\)[\s\S]*?\.delete\(\)[\s\S]*?removeSkillThumb/,
  "revert must delete the row before best-effort old-thumb cleanup"
);
assert.match(
  configsSource,
  /if \(!builtin\)[\s\S]*?\.delete\(\)[\s\S]*?removeSkillThumb/,
  "custom delete must remove the row before best-effort old-thumb cleanup"
);
assert.match(
  configsSource,
  /includeHidden\?: boolean/,
  "resolveLiveSkill must allow admins to run private master skills"
);

const modifyPanel = readFileSync(
  new URL("../app/(app)/tools/skills/SkillModifyPanel.tsx", import.meta.url),
  "utf8"
);
assert.match(
  modifyPanel,
  /Visibility/,
  "master skill editor must expose public/private visibility"
);
assert.match(
  modifyPanel,
  /body\.hidden = visibility === "private"/,
  "visibility must map to the skill_configs.hidden column"
);

const adminPatch = readFileSync(
  new URL("../app/api/admin/skills/[skillId]/route.ts", import.meta.url),
  "utf8"
);
assert.match(
  adminPatch,
  /"hidden" in body/,
  "admin skill PATCH must accept hidden for visibility"
);

for (const relativePath of [
  "../app/api/admin/skills/[skillId]/thumb/route.ts",
  "../app/api/skills/[skillId]/thumb/route.ts",
]) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  assert.match(
    source,
    /replace(?:Catalog|Owned)SkillThumb/,
    `${relativePath} must replace and compensate thumbnails through the shared lifecycle`
  );
}

console.log("admin skills catalog self-check passed");
}

void main();
