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

/** Image-prompt style instruction for a (possibly untrusted) style value. */
export function storyboardStyleInstruction(raw: unknown): string {
  return STORYBOARD_STYLE_INSTRUCTIONS[resolveStoryboardStyle(raw)];
}

/** Video-prompt style directive for a (possibly untrusted) style value. */
export function storyboardVideoStyleDirective(raw: unknown): string {
  return STORYBOARD_VIDEO_STYLE_DIRECTIVES[resolveStoryboardStyle(raw)];
}
