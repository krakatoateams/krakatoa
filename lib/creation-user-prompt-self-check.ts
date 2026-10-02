import type { CreationHistoryItem } from "@/lib/creations";
import { getCreationUserPrompt } from "@/lib/creation-user-prompt";

/**
 * Pure — no DOM, no network — so it stays runnable as a self-check
 * (`npx tsx lib/creation-user-prompt-self-check.ts`), mirroring
 * lib/aspect-ratio-match.ts.
 */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function item(metadata: Record<string, unknown>): CreationHistoryItem {
  return {
    id: "id",
    tool: "reels_seedance",
    toolLabel: "Reels (Seedance 2 Fast)",
    mediaType: "video",
    mediaUrl: "url",
    storagePath: "path",
    title: "title",
    createdAt: new Date().toISOString(),
    metadata,
  };
}

export function creationUserPromptSelfCheck(): void {
  // reels_seedance / reels_veo: theme is stored under prompt, alongside AI-derived
  // scenePrompts/narration that must never surface as "the user's prompt".
  assert(
    getCreationUserPrompt(
      item({ engine: "seedance", prompt: "a cat skateboarding", scenePrompts: ["s1", "s2"], narration: "voiceover" })
    ) === "a cat skateboarding",
    "reels_seedance must return the typed theme, not scene prompts/narration"
  );
  assert(
    getCreationUserPrompt(
      item({ engine: "veo", prompt: "sunset timelapse", scenePrompts: ["s1"], narration: "n" })
    ) === "sunset timelapse",
    "reels_veo must return the typed theme, not scene prompts/narration"
  );

  // product_photo / t2v / i2v / motion-control: explicit userPrompt wins.
  assert(
    getCreationUserPrompt(item({ userPrompt: "studio lighting", prompt: "studio lighting" })) ===
      "studio lighting",
    "product_photo must return the explicit userPrompt"
  );
  assert(
    getCreationUserPrompt(item({ userPrompt: "a dog running" })) === "a dog running",
    "t2v/i2v must return the explicit userPrompt"
  );
  assert(
    getCreationUserPrompt(item({ userPrompt: "zoom in slowly" })) === "zoom in slowly",
    "motion-control must return the explicit userPrompt"
  );

  // storyboard: theme is written to both prompt and userPrompt.
  assert(
    getCreationUserPrompt(item({ prompt: "product launch", userPrompt: "product launch" })) ===
      "product launch",
    "storyboard must return the typed theme"
  );

  // Pure viral template runs carry no user-typed text — never leak the template title.
  assert(
    getCreationUserPrompt(
      item({ viralTemplateId: "tpl_1", viralTemplateTitle: "Unboxing Hype", prompt: "Unboxing Hype" })
    ) === "",
    "a viral template run must return empty, never the template title"
  );
  assert(
    getCreationUserPrompt(
      item({ prompt: 'Viral template "Unboxing Hype" (template id: tpl_1) full assembled prompt...' })
    ) === "",
    "a legacy assembled viral prompt must return empty"
  );

  // No prompt at all.
  assert(getCreationUserPrompt(item({})) === "", "an item with no prompt metadata must return empty");
}

if (require.main === module) {
  creationUserPromptSelfCheck();
  console.log("creationUserPromptSelfCheck: ok");
}
