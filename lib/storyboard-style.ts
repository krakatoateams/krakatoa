/**
 * Storyboard style — single source of truth (shared by the storyboard image route
 * and the storyboard→video route) so the style the user picks is honored in BOTH
 * the storyboard sheet AND the generated video.
 *
 * Two layers per style:
 *   - IMAGE instruction  -> shapes the six-panel storyboard sheet (GPT Image).
 *   - VIDEO directive     -> shapes the Seedance video aesthetic so the clip
 *                            matches the storyboard's look (not just composition).
 *
 * Keys/labels mirror the frontend STORYBOARD_STYLE_OPTIONS in
 * app/(app)/tools/reels/page.tsx.
 */

export const STORYBOARD_STYLE_KEYS = [
  "cinematic_sketch",
  "painterly_color",
  "comic_book",
  "photorealistic",
  "anime_manga",
] as const;

export type StoryboardStyleKey = (typeof STORYBOARD_STYLE_KEYS)[number];

export const DEFAULT_STORYBOARD_STYLE: StoryboardStyleKey = "cinematic_sketch";

/** Human labels for the storyboard style chip (shared by Photo + Video UIs). */
export const STORYBOARD_STYLE_LABELS: Record<StoryboardStyleKey, string> = {
  cinematic_sketch: "Cinematic Sketch",
  painterly_color: "Painterly Color",
  comic_book: "Comic Book",
  photorealistic: "Photorealistic",
  anime_manga: "Anime / Manga",
};

/** Instruction injected into the storyboard IMAGE prompt (GPT Image). */
export const STORYBOARD_STYLE_INSTRUCTIONS: Record<StoryboardStyleKey, string> = {
  cinematic_sketch:
    "Style: cinematic storyboard sketch — pencil/ink linework, light shading, optional camera arrows, readable at a glance.",
  painterly_color:
    "Style: full color painterly storyboard — watercolor and gouache technique, warm cinematic color palette, soft edges.",
  comic_book:
    "Style: comic book storyboard — bold thick ink outlines, high contrast, flat color fills, dynamic panel composition.",
  photorealistic:
    "Style: photorealistic storyboard — rendered like film production stills, detailed lighting, realistic textures and faces.",
  anime_manga:
    "Style: anime and manga storyboard — Japanese animation linework, expressive character faces, clean ink, minimal shading.",
};

/**
 * Directive prepended to the Seedance VIDEO prompt so the motion clip is rendered
 * in the same aesthetic the user picked for the storyboard — not just realistic
 * footage that happens to follow the composition. Phrased for a final video (no
 * "storyboard sheet" wording, which would confuse the video model).
 */
export const STORYBOARD_VIDEO_STYLE_DIRECTIVES: Record<StoryboardStyleKey, string> = {
  cinematic_sketch:
    "Visual style: animated cinematic storyboard sketch — hand-drawn pencil/ink linework with light shading, a moving animatic look. Keep this drawn sketch aesthetic consistently across the entire clip.",
  painterly_color:
    "Visual style: painterly animation — watercolor and gouache textures, soft edges, warm cinematic color palette, hand-painted look throughout the entire clip.",
  comic_book:
    "Visual style: comic-book animation — bold thick ink outlines, high contrast, flat cel-shaded color fills, dynamic comic framing throughout the entire clip.",
  photorealistic:
    "Visual style: photorealistic live-action film look — realistic lighting, textures, and faces, like real cinematic footage throughout the entire clip.",
  anime_manga:
    "Visual style: anime/manga animation — Japanese cel-animation linework, expressive faces, clean ink, vibrant flat shading throughout the entire clip.",
};

/** Normalize an untrusted style value to a known key (default cinematic_sketch). */
export function resolveStoryboardStyle(raw: unknown): StoryboardStyleKey {
  const s = typeof raw === "string" ? raw.trim() : "";
  return (STORYBOARD_STYLE_KEYS as readonly string[]).includes(s)
    ? (s as StoryboardStyleKey)
    : DEFAULT_STORYBOARD_STYLE;
}

/**
 * Aspect ratio — shared by the storyboard image route and the storyboard→video
 * route so the orientation the user picks at storyboard time is the SAME
 * orientation the video is rendered in. We start with the two most common
 * choices (vertical Reels/TikTok and widescreen). The storyboard sheet stays a
 * grid; the chosen ratio only changes how each PANEL is framed (the panels are
 * the video frames) and the Seedance `aspect_ratio` of the final clip.
 */
export const STORYBOARD_ASPECT_RATIOS = ["16:9", "9:16"] as const;
export type StoryboardAspectRatio = (typeof STORYBOARD_ASPECT_RATIOS)[number];
export const DEFAULT_STORYBOARD_ASPECT_RATIO: StoryboardAspectRatio = "16:9";

/** Normalize an untrusted aspect value to a known ratio (default 16:9). */
export function resolveStoryboardAspectRatio(raw: unknown): StoryboardAspectRatio {
  const s = typeof raw === "string" ? raw.trim() : "";
  return (STORYBOARD_ASPECT_RATIOS as readonly string[]).includes(s)
    ? (s as StoryboardAspectRatio)
    : DEFAULT_STORYBOARD_ASPECT_RATIO;
}

/** Plain-English orientation word for labels/prompts. */
export function storyboardOrientationLabel(
  ar: StoryboardAspectRatio
): "Vertical" | "Horizontal" {
  return ar === "9:16" ? "Vertical" : "Horizontal";
}

/**
 * Framing directive injected into the storyboard IMAGE prompt so each panel is
 * drawn in the chosen orientation. The sheet is still a grid, but the panels
 * (which the video model treats as composition references) must be framed for
 * the eventual video orientation — otherwise a vertical video would be planned
 * with widescreen panels.
 */
export function storyboardImageAspectDirective(ar: StoryboardAspectRatio): string {
  return ar === "9:16"
    ? "Frame every panel as a TALL vertical 9:16 shot (portrait, like a phone / Reels / TikTok screen). Compose each scene for a vertical video frame."
    : "Frame every panel as a WIDE horizontal 16:9 shot (landscape, like a cinema / YouTube frame). Compose each scene for a widescreen video frame.";
}

/**
 * Aspect directive baked into the Seedance VIDEO prompt. The provider
 * `aspect_ratio` param is authoritative, but reinforcing it in the prompt keeps
 * older storyboards (whose stored prompt may mention a fixed ratio) consistent.
 */
export function storyboardVideoAspectDirective(ar: StoryboardAspectRatio): string {
  return ar === "9:16"
    ? "Render a vertical 9:16 video (portrait, full-frame for Reels/TikTok/Shorts)."
    : "Render a widescreen 16:9 video (landscape, cinematic full-frame).";
}

/**
 * Pixel dimensions for a storyboard video asset, given the Seedance resolution
 * tier (480p/720p) and the chosen aspect ratio. Stored on the asset row so the
 * scheduler/preview know the true output orientation.
 */
export function storyboardVideoDimensions(
  resolution: "480p" | "720p",
  ar: StoryboardAspectRatio
): { width: number; height: number } {
  const long = resolution === "720p" ? 1280 : 854;
  const short = resolution === "720p" ? 720 : 480;
  return ar === "9:16"
    ? { width: short, height: long }
    : { width: long, height: short };
}

/**
 * Spoken language — controls the language of the dialogue/narration the scene
 * LLM writes (and that Seedance speaks). The default is ENGLISH (the model used
 * to hardcode Indonesian). The language is chosen at storyboard time and stored,
 * but the storyboard→video step may override it (a soft property: re-instructing
 * the model to speak another language is reasonable, unlike orientation).
 */
export const STORYBOARD_LANGUAGES = [
  { id: "english", label: "English" },
  { id: "indonesian", label: "Indonesian" },
  { id: "spanish", label: "Spanish" },
  { id: "portuguese", label: "Portuguese" },
  { id: "french", label: "French" },
  { id: "german", label: "German" },
  { id: "japanese", label: "Japanese" },
  { id: "korean", label: "Korean" },
  { id: "mandarin", label: "Mandarin Chinese" },
  { id: "hindi", label: "Hindi" },
  { id: "arabic", label: "Arabic" },
] as const;

export type StoryboardLanguageId = (typeof STORYBOARD_LANGUAGES)[number]["id"];
export const DEFAULT_STORYBOARD_LANGUAGE: StoryboardLanguageId = "english";

const STORYBOARD_LANGUAGE_LABELS: Record<StoryboardLanguageId, string> =
  Object.fromEntries(STORYBOARD_LANGUAGES.map((l) => [l.id, l.label])) as Record<
    StoryboardLanguageId,
    string
  >;

/** Normalize an untrusted language value to a known id (default english). */
export function resolveStoryboardLanguage(raw: unknown): StoryboardLanguageId {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return STORYBOARD_LANGUAGES.some((l) => l.id === s)
    ? (s as StoryboardLanguageId)
    : DEFAULT_STORYBOARD_LANGUAGE;
}

/** Human label for a (possibly untrusted) language id. */
export function storyboardLanguageLabel(raw: unknown): string {
  return STORYBOARD_LANGUAGE_LABELS[resolveStoryboardLanguage(raw)];
}

/**
 * Language directive baked into the Seedance VIDEO prompt so all spoken
 * dialogue/narration is rendered in the chosen language. Also covers the
 * override case (storyboard written in language A, video requested in B) by
 * telling the model to translate any quoted lines.
 */
export function storyboardLanguageDirective(raw: unknown): string {
  const label = storyboardLanguageLabel(raw);
  return `All spoken dialogue and narration must be in ${label}. If any quoted lines are written in another language, translate them into ${label}.`;
}

/** Image-prompt style instruction for a (possibly untrusted) style value. */
export function storyboardStyleInstruction(raw: unknown): string {
  return STORYBOARD_STYLE_INSTRUCTIONS[resolveStoryboardStyle(raw)];
}

/** Video-prompt style directive for a (possibly untrusted) style value. */
export function storyboardVideoStyleDirective(raw: unknown): string {
  return STORYBOARD_VIDEO_STYLE_DIRECTIVES[resolveStoryboardStyle(raw)];
}
