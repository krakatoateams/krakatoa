/**
 * #445: Photo and Skills recover from a temporary model-state failure (retry on focus + Retry button),
 * and Skills warns only for its own kind's model list.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { skillModelsUnavailable } from "./use-model-state-retry";

// Split flag: a failed photo read never warns on a video skill, and vice versa.
assert.equal(skillModelsUnavailable({ isVideo: true, photoFailed: true, videoFailed: false }), false);
assert.equal(skillModelsUnavailable({ isVideo: false, photoFailed: false, videoFailed: true }), false);
assert.equal(skillModelsUnavailable({ isVideo: true, photoFailed: false, videoFailed: true }), true);
assert.equal(skillModelsUnavailable({ isVideo: false, photoFailed: true, videoFailed: false }), true);

const hook = readFileSync("lib/use-model-state-retry.ts", "utf8");
assert.ok(hook.includes('"visibilitychange"') && hook.includes('"focus"'), "retries on tab visibility and window focus");

const photo = readFileSync("app/(app)/tools/photo-v2/page.tsx", "utf8");
assert.ok(photo.includes("useRetryWhenVisible(featuresFailed && !featureModels, retryFeatures)"), "photo retries while failed");
assert.ok(photo.includes("}, [featuresAttempt]);") && photo.includes("onClick={retryFeatures}"), "photo refetches on retry and shows a Retry button");

const skills = readFileSync("app/(app)/tools/skills/SkillComposer.tsx", "utf8");
assert.ok(!skills.includes("setModelsUnavailable"), "skills no longer shares one flag");
assert.ok(skills.includes("setPhotoModelsFailed(true)") && skills.includes("setVideoModelsFailed(true)"), "skills tracks each list");
assert.equal((skills.match(/\}, \[status, featuresAttempt\]\);/g) ?? []).length, 2, "both lists refetch on retry");
assert.ok(skills.includes("onClick={retryFeatures}"), "skills shows a Retry button");

console.log("model-state retry self-check passed");
