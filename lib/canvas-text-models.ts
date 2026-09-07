/**
 * Canvas Text node models.
 *
 * GPT-5 is the default because Gemini 2.5 Flash on Replicate does not reliably
 * use `image_input` (confirmed in generate-caption: attached stills are ignored
 * or the model invents a different scene). Storyboard import vision uses GPT-5
 * the same way.
 */

export const CANVAS_TEXT_MODEL_IDS = ["gpt5", "gemini_flash"] as const;
export type CanvasTextModelId = (typeof CANVAS_TEXT_MODEL_IDS)[number];

export type CanvasTextModelFamily = "gpt5" | "gemini";

export type CanvasTextModel = {
  id: CanvasTextModelId;
  label: string;
  provider: "replicate";
  model: string;
  family: CanvasTextModelFamily;
  vision: boolean;
};

export const CANVAS_TEXT_MODELS: CanvasTextModel[] = [
  {
    id: "gpt5",
    label: "GPT-5",
    provider: "replicate",
    model: "openai/gpt-5",
    family: "gpt5",
    vision: true,
  },
  {
    id: "gemini_flash",
    label: "Gemini 2.5 Flash",
    provider: "replicate",
    model: "google/gemini-2.5-flash",
    family: "gemini",
    vision: false,
  },
];

export const DEFAULT_CANVAS_TEXT_MODEL_ID: CanvasTextModelId = "gpt5";

const BY_ID = new Map(CANVAS_TEXT_MODELS.map((model) => [model.id, model]));

export function isCanvasTextModelId(value: string): value is CanvasTextModelId {
  return BY_ID.has(value as CanvasTextModelId);
}

export function getCanvasTextModel(id: string | null | undefined): CanvasTextModel {
  if (id && BY_ID.has(id as CanvasTextModelId)) return BY_ID.get(id as CanvasTextModelId)!;
  return BY_ID.get(DEFAULT_CANVAS_TEXT_MODEL_ID)!;
}

export function buildCanvasTextProviderInput(params: {
  family: CanvasTextModelFamily;
  prompt: string;
  system: string;
  imageUrls: string[];
}): Record<string, unknown> {
  const image_input = params.imageUrls.length > 0 ? params.imageUrls : undefined;
  if (params.family === "gpt5") {
    return {
      prompt: params.prompt,
      system_prompt: params.system,
      max_completion_tokens: 1024,
      reasoning_effort: "low",
      ...(image_input ? { image_input } : {}),
    };
  }
  return {
    prompt: params.prompt,
    system_instruction: params.system,
    max_output_tokens: 1024,
    temperature: image_input ? 0.3 : 0.7,
    thinking_budget: 0,
    ...(image_input ? { image_input } : {}),
  };
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`canvas-text-models self-check: ${msg}`);
}

export function canvasTextModelsSelfCheck(): void {
  const gpt = buildCanvasTextProviderInput({
    family: "gpt5",
    prompt: "describe the image",
    system: "Follow the instruction.",
    imageUrls: ["https://replicate.delivery/x.png"],
  });
  assert(gpt.system_prompt === "Follow the instruction.", "GPT-5 uses system_prompt");
  assert(Array.isArray(gpt.image_input) && gpt.image_input[0] === "https://replicate.delivery/x.png", "GPT-5 receives image_input");
  assert(!("system_instruction" in gpt), "GPT-5 does not use Gemini system_instruction");
  assert(getCanvasTextModel("nope").id === "gpt5", "unknown ids fall back to GPT-5");
}

if (typeof require !== "undefined" && require.main === module) {
  canvasTextModelsSelfCheck();
  console.log("canvasTextModelsSelfCheck: ok");
}
