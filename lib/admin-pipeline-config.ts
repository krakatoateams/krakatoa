/**
 * Admin Config v2 — pipeline role registry (fixed steps, not user-picked models).
 */

export type PipelineRoleSpec = {
  modelConfigToolKey: string;
  configKey: string;
  label: string;
  description?: string;
};

export type PipelineGroupSpec = {
  key: string;
  label: string;
  description?: string;
  adminToolKey: "reels" | "photo";
  roles: PipelineRoleSpec[];
  pricingKeys?: { pricingKey: string; label: string }[];
};

export const PIPELINE_GROUP_SPECS: PipelineGroupSpec[] = [
  {
    adminToolKey: "reels",
    key: "reels-creator",
    label: "Reels Creator",
    description: "Script, voiceover, and captions when Reels Creator runs on the Seedance engine.",
    roles: [
      { modelConfigToolKey: "reels", configKey: "llm", label: "Script LLM" },
      { modelConfigToolKey: "reels", configKey: "tts", label: "Voiceover TTS" },
      {
        modelConfigToolKey: "reels",
        configKey: "whisper",
        label: "Transcription (Whisper)",
      },
    ],
  },
  {
    adminToolKey: "reels",
    key: "reels-creator-veo",
    label: "Reels Creator · Veo engine",
    description: "Same pipeline roles when the user picks Veo inside Reels Creator.",
    roles: [
      { modelConfigToolKey: "veo", configKey: "llm", label: "Script LLM" },
      { modelConfigToolKey: "veo", configKey: "tts", label: "Voiceover TTS" },
      { modelConfigToolKey: "veo", configKey: "whisper", label: "Transcription (Whisper)" },
    ],
  },
  {
    adminToolKey: "reels",
    key: "storyboard-video",
    label: "Storyboard to video",
    description:
      "Turns a storyboard sheet into a clip. The video step uses whichever generation model above has Storyboard to video enabled — configure default models in the Mode table, not here.",
    roles: [],
  },
  {
    adminToolKey: "photo",
    key: "storyboard-sheet",
    label: "Storyboard sheet",
    description:
      "Six-panel storyboard from Photo studio → Storyboard mode (generate + import). Video continuation is under Video → Storyboard to video.",
    roles: [
      {
        modelConfigToolKey: "storyboard",
        configKey: "scene_llm",
        label: "Scene LLM",
        description: "Scene breakdown; also powers import vision analysis.",
      },
      {
        modelConfigToolKey: "storyboard",
        configKey: "image",
        label: "Storyboard image",
        description: "Renders the six-panel sheet (GPT Image 2).",
      },
    ],
    pricingKeys: [
      { pricingKey: "storyboard_gpt_image_2_low_per_image", label: "Image · Low" },
      { pricingKey: "storyboard_gpt_image_2_medium_per_image", label: "Image · Medium" },
      { pricingKey: "storyboard_gpt_image_2_auto_per_image", label: "Image · Auto" },
      { pricingKey: "storyboard_import_vision_per_image", label: "Import · Vision" },
    ],
  },
];
