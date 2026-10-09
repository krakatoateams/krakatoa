import assert from "node:assert/strict";
import { MOTION_CONTROL_MODELS } from "./motion-control-models";
import { SKILL_VIDEO_PROMPT_MAX_CHARS, videoPromptLimitError, videoPromptMaxChars } from "./skills";
import { assembleStoryboardVideoPrompt } from "./storyboard-style";
import { VIDEO_MODEL_REGISTRY } from "./video-models";

// Verified or decided limits (see comments in video-models.ts). Anything absent keeps the default.
const EXPECTED: Record<string, number> = {
  seedance2_mini: 4000,
  seedance2_fast: 4000, // platform cap; Replicate publishes no maxLength for Fast
  seedance2: 4000,
  veo31_fast: 3000,
  veo31_lite: 3000,
  grok_imagine_video: 2500, // user-observed provider message
  kling_v3: 2500,
  kling_v3_omni: 2500,
  kling21: 2500,
  kling25_turbo_pro: 2500,
  kling26: 2500,
  kling_v3_motion: 2500,
  kling26_motion: 2500,
};

const models: { id: string; promptMaxChars?: number }[] = [...VIDEO_MODEL_REGISTRY, ...MOTION_CONTROL_MODELS];
for (const m of models) {
  const limit = videoPromptMaxChars(m);
  assert.equal(limit, EXPECTED[m.id] ?? SKILL_VIDEO_PROMPT_MAX_CHARS, `limit for ${m.id}`);
  assert.equal(videoPromptLimitError("a".repeat(limit), limit), null, `${m.id} accepts exactly the limit`);
  assert.equal(
    videoPromptLimitError("a".repeat(limit + 1), limit),
    `Your prompt is too long (${(limit + 1).toLocaleString("en-US")} characters). The limit is ${limit.toLocaleString("en-US")}.`,
    `${m.id} rejects limit+1 naming its own limit`
  );
}
const ids = new Set(models.map((m) => m.id));
for (const id of Object.keys(EXPECTED)) assert.ok(ids.has(id), `expected model ${id} exists`);
// A prompt valid for the 4,000 default is flagged after switching to a 2,500 model, never cut.
assert.ok(videoPromptLimitError("a".repeat(3000), videoPromptMaxChars({ promptMaxChars: 2500 })));
// Storyboard: the shared assembled prompt counts directives + [Image1], so a body at the
// limit is over it; a body that fills the remaining room is ok and +1 names the limit.
const sb = (body: string) => assembleStoryboardVideoPrompt({ body, style: "comic_book", aspectRatio: "9:16", language: "english" });
const overhead = sb("[Image1]").length - "[Image1]".length;
assert.ok(overhead > 200, "directive overhead counted");
assert.ok(videoPromptLimitError(sb("a".repeat(4000)), 4000), "4000-char body + overhead is over the limit");
const room = 4000 - sb("[Image1]").length + "[Image1]".length;
const fit = "[Image1]" + "a".repeat(room - "[Image1]".length);
assert.equal(sb(fit).length, 4000);
assert.equal(videoPromptLimitError(sb(fit), 4000), null, "assembled length == limit ok");
assert.match(videoPromptLimitError(sb(fit + "a"), 4000) ?? "", /The limit is 4,000\./, "+1 rejected naming limit");
console.log("video prompt limits self-check passed");
