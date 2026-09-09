/**
 * Skills catalog — specialized generation recipes listed under Create → Skills.
 *
 * Live recipes POST to the existing generate-photo / generate-video routes.
 * Catalog stays in code (same pattern as lib/trending-templates.ts). Do not add
 * a CREATION_TOOLS key; outputs keep product_photo / video_* so library +
 * Animate hand-off stay valid.
 */

import type { VideoResolution } from "@/lib/video-models";

export const SKILL_IDS = [
  "high-quality-film",
  "video-clone",
  "ai-animations",
  "ai-story",
  "trend-inspire",
  "explainer",
  "character-ip",
  "ai-storyboard",
  "script-writer",
  "wes-anderson",
  "anime",
  "stop-motion",
  "cinematic-trailer",
  "comic-panels",
  "branding-ads",
  "ugc-ads",
  "fashion-try-on",
  "music-videos",
  "hook-ads",
  "unboxing",
  "testimonial",
  "food-ads",
  "logo-identity",
  "product-listing",
  "poster",
  "image-kit",
  "change-background",
  "change-character",
  "product-packaging",
  "social-thumbnail",
  "lookbook",
  "headshot",
  "welcome-video",
] as const;

export type BuiltinSkillId = (typeof SKILL_IDS)[number];

/**
 * Deep-link target for the new-signup "claim your free video" offer (see
 * WelcomeVideoOfferCard + /api/welcome-video-offer). Pinned to the cheapest
 * live video config (Seedance 1 Pro Fast, 480p, 5s, no audio — 2 credits/sec
 * = 10 credits) so it costs exactly what the welcome-bonus grant covers.
 */
export const WELCOME_VIDEO_SKILL_ID: BuiltinSkillId = "welcome-video";

/** Runtime catalog id — a builtin slug or an admin-created slug. */
export type SkillId = string;

/** 2–48 chars, lowercase kebab-case, starts and ends with an alphanumeric. */
export const SKILL_SLUG_RE = /^[a-z][a-z0-9-]{0,46}[a-z0-9]$/;

export function isSkillSlug(id: string): boolean {
  return SKILL_SLUG_RE.test(id) && !id.includes("--");
}

export function slugifySkillId(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return isSkillSlug(base) ? base : `skill-${Date.now().toString(36)}`;
}

export type SkillMediaType = "image" | "video";

export type SkillIconName =
  | "scroll"
  | "copy"
  | "video"
  | "book"
  | "spark"
  | "wand"
  | "smile"
  | "layout"
  | "pen"
  | "bag"
  | "user"
  | "shirt"
  | "music"
  | "tag"
  | "grid"
  | "align"
  | "layers"
  | "image"
  | "sparkles"
  | "clapper"
  | "box"
  | "flame"
  | "camera"
  | "utensils";

export type SkillCategoryId = "storytelling" | "marketing" | "branding";

export type SkillInputSlot = {
  key: string;
  label: string;
  required: boolean;
};

export const SKILL_INPUT_KEYS = ["startFrame", "subject", "scene", "character"] as const;
export type SkillInputKey = (typeof SKILL_INPUT_KEYS)[number];

export const SKILL_INPUT_DEFAULTS: Record<
  SkillInputKey,
  { label: string; mediaType: SkillMediaType }
> = {
  startFrame: { label: "Start frame", mediaType: "video" },
  subject: { label: "Ref", mediaType: "image" },
  scene: { label: "Scene", mediaType: "image" },
  character: { label: "Character", mediaType: "image" },
};

export function defaultSkillInputs(mediaType: SkillMediaType): SkillInputSlot[] {
  if (mediaType === "video") {
    return [{ key: "startFrame", label: SKILL_INPUT_DEFAULTS.startFrame.label, required: false }];
  }
  return [{ key: "subject", label: SKILL_INPUT_DEFAULTS.subject.label, required: false }];
}

export type SkillPhotoMode = "image" | "product" | "character";

export type Skill = {
  id: SkillId;
  title: string;
  description: string;
  category: SkillCategoryId;
  mediaType: SkillMediaType;
  icon: SkillIconName;
  thumb: string;
  promptPlaceholder: string;
  promptRequired: boolean;
  inputs: SkillInputSlot[];
  comingSoon?: boolean;
  /** Open another studio instead of the Agent omni form. */
  openHref?: string;
  badge?: "new";
  /** Admin-pinned Photo tier or Video model. Absent = catalog default. */
  modelId?: string;
  /**
   * Pin the video resolution too (video skills only). Absent = the model's
   * own default resolution. Every catalog video model defaults to 720p or
   * 1080p, so a skill that wants a specific cheap resolution (e.g. the
   * welcome-offer skill's 480p) has to say so explicitly — pinning modelId
   * alone isn't enough.
   */
  resolution?: VideoResolution;
};

export const SKILL_CATEGORIES: { id: SkillCategoryId; title: string }[] = [
  { id: "storytelling", title: "Creative Storytelling" },
  { id: "marketing", title: "Marketing Videos" },
  { id: "branding", title: "Branding Assets" },
];

/** Catalog stills live in `public/skills/{id}.jpg` — not Unsplash, not Storage. */
const thumb = (id: SkillId) => `/skills/${id}.jpg`;

export const SKILLS: Skill[] = [
  {
    id: "high-quality-film",
    title: "AI Film",
    description: "Cinematic video with film-grade lighting, lens, and motion.",
    category: "storytelling",
    mediaType: "video",
    icon: "scroll",
    thumb: thumb("high-quality-film"),
    promptPlaceholder: "A quiet street at dusk, camera slowly pushing in…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "video-clone",
    title: "Video Clone",
    description: "Perform in a clip using a reference person.",
    category: "storytelling",
    mediaType: "video",
    icon: "copy",
    thumb: thumb("video-clone"),
    promptPlaceholder: "Walking through a sunlit market, glancing at the camera…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Person", required: true }],
  },
  {
    id: "ai-animations",
    title: "AI Animations",
    description: "Stylized animated clips from a prompt.",
    category: "storytelling",
    mediaType: "video",
    icon: "video",
    thumb: thumb("ai-animations"),
    promptPlaceholder: "A paper-craft fox leaping between floating lanterns…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "ai-story",
    title: "AI Story",
    description: "Turn a premise into a short narrative film.",
    category: "storytelling",
    mediaType: "video",
    icon: "book",
    thumb: thumb("ai-story"),
    promptPlaceholder: "A baker finds a letter in a loaf that changes her day…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "trend-inspire",
    title: "Trend inspire",
    description: "Jump on a current visual trend.",
    category: "storytelling",
    mediaType: "video",
    icon: "spark",
    thumb: thumb("trend-inspire"),
    promptPlaceholder: "Matcha pour, snap-zoom, then a satisfied first sip…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
    badge: "new",
  },
  {
    id: "explainer",
    title: "Explainer",
    description: "Clear product or idea explainers.",
    category: "storytelling",
    mediaType: "video",
    icon: "wand",
    thumb: thumb("explainer"),
    promptPlaceholder: "How this bottle keeps drinks cold for 24 hours…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "character-ip",
    title: "Character IP",
    description: "Consistent character turnarounds and sheets.",
    category: "storytelling",
    mediaType: "image",
    icon: "smile",
    thumb: thumb("character-ip"),
    promptPlaceholder: "A mischievous raccoon in a tiny red bomber jacket…",
    promptRequired: true,
    inputs: [{ key: "subject", label: "Ref", required: false }],
  },
  {
    id: "ai-storyboard",
    title: "AI Storyboard",
    description: "Six-panel storyboard from a concept.",
    category: "storytelling",
    mediaType: "image",
    icon: "layout",
    thumb: thumb("ai-storyboard"),
    promptPlaceholder: "A courier misses the last train, then finds a door that shouldn't be there…",
    promptRequired: true,
    inputs: [],
    openHref: "/tools/photo-v2?type=storyboard",
  },
  {
    id: "script-writer",
    title: "Script Writer",
    description: "Write a short-form script from a brief.",
    category: "storytelling",
    mediaType: "video",
    icon: "pen",
    thumb: thumb("script-writer"),
    promptPlaceholder: "A 15-second hook: founder quits a desk job to roast coffee…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "wes-anderson",
    title: "Wes Anderson",
    description: "Symmetrical, pastel, centered-frame films.",
    category: "storytelling",
    mediaType: "video",
    icon: "scroll",
    thumb: thumb("wes-anderson"),
    promptPlaceholder: "A concierge slides a tiny key across a pink marble desk…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "anime",
    title: "Anime",
    description: "Hand-drawn anime motion, not live-action.",
    category: "storytelling",
    mediaType: "video",
    icon: "sparkles",
    thumb: thumb("anime"),
    promptPlaceholder: "A girl on a rooftop at dusk, wind in her hair, city lights blooming…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "stop-motion",
    title: "Stop Motion",
    description: "Tactile frame-by-frame craft animation.",
    category: "storytelling",
    mediaType: "video",
    icon: "box",
    thumb: thumb("stop-motion"),
    promptPlaceholder: "A clay fox packing a tiny suitcase under a desk lamp…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "cinematic-trailer",
    title: "Trailer",
    description: "Movie-trailer energy in one continuous shot.",
    category: "storytelling",
    mediaType: "video",
    icon: "clapper",
    thumb: thumb("cinematic-trailer"),
    promptPlaceholder: "A lone rider crests a ridge at golden hour, title-card silence…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "comic-panels",
    title: "Comic",
    description: "Bold comic or manga panel stills.",
    category: "storytelling",
    mediaType: "image",
    icon: "layout",
    thumb: thumb("comic-panels"),
    promptPlaceholder: "A hero catching a falling neon sign, rain, speed lines, one word: HOLD…",
    promptRequired: true,
    inputs: [{ key: "subject", label: "Ref", required: false }],
  },
  {
    id: "branding-ads",
    title: "Branding Ads",
    description: "Polished product hero spots.",
    category: "marketing",
    mediaType: "video",
    icon: "bag",
    thumb: thumb("branding-ads"),
    promptPlaceholder: "A perfume bottle catching a shaft of golden light…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "ugc-ads",
    title: "UGC Ads",
    description: "Native-feeling creator-style ads.",
    category: "marketing",
    mediaType: "video",
    icon: "user",
    thumb: thumb("ugc-ads"),
    promptPlaceholder: "Handheld kitchen demo of a gadget that slices herbs…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "fashion-try-on",
    title: "Fashion Try On",
    description: "Put a product on a model or character.",
    category: "marketing",
    mediaType: "image",
    icon: "shirt",
    thumb: thumb("fashion-try-on"),
    promptPlaceholder: "A linen jacket on a model, sunlit rooftop, full-length…",
    promptRequired: true,
    inputs: [],
    openHref: "/tools/photo-v2?type=product-tryon",
  },
  {
    id: "music-videos",
    title: "Music Videos",
    description: "Rhythm-led performance clips.",
    category: "marketing",
    mediaType: "video",
    icon: "music",
    thumb: thumb("music-videos"),
    promptPlaceholder: "A singer in neon rain, camera circling on the chorus…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "hook-ads",
    title: "Hook Ads",
    description: "First-second scroll-stoppers.",
    category: "marketing",
    mediaType: "video",
    icon: "flame",
    thumb: thumb("hook-ads"),
    promptPlaceholder: "She drops the blender lid, freeze, then the smoothie pours itself…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
    badge: "new",
  },
  {
    id: "unboxing",
    title: "Unboxing",
    description: "Satisfying product-reveal clips.",
    category: "marketing",
    mediaType: "video",
    icon: "box",
    thumb: thumb("unboxing"),
    promptPlaceholder: "Hands peel tape on a matte black box, then lift out headphones…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "testimonial",
    title: "Testimonial",
    description: "Talking-head social proof.",
    category: "marketing",
    mediaType: "video",
    icon: "user",
    thumb: thumb("testimonial"),
    promptPlaceholder: "Founder at a kitchen table: this saved us two hours every morning…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Person", required: false }],
  },
  {
    id: "food-ads",
    title: "Food Ads",
    description: "Steam, pour, and bite-close food spots.",
    category: "marketing",
    mediaType: "video",
    icon: "utensils",
    thumb: thumb("food-ads"),
    promptPlaceholder: "Slow pour of glossy ramen broth, chopsticks lifting noodles…",
    promptRequired: true,
    inputs: [{ key: "startFrame", label: "Start frame", required: false }],
  },
  {
    id: "logo-identity",
    title: "Logo & Branding",
    description: "Mark, lockup, and brand-kit stills.",
    category: "branding",
    mediaType: "image",
    icon: "tag",
    thumb: thumb("logo-identity"),
    promptPlaceholder: "A quiet wordmark for a coastal pottery studio named Dune…",
    promptRequired: true,
    inputs: [{ key: "subject", label: "Ref", required: false }],
  },
  {
    id: "product-listing",
    title: "Product Listing",
    description: "Marketplace-ready product sets.",
    category: "branding",
    mediaType: "image",
    icon: "grid",
    thumb: thumb("product-listing"),
    promptPlaceholder: "Matte black headphones on a clean seamless white sweep…",
    promptRequired: true,
    inputs: [{ key: "subject", label: "Product", required: false }],
  },
  {
    id: "poster",
    title: "Poster",
    description: "Campaign posters with type and product.",
    category: "branding",
    mediaType: "image",
    icon: "align",
    thumb: thumb("poster"),
    promptPlaceholder: "Summer night market poster, bold type, lanterns, a coffee cart…",
    promptRequired: true,
    inputs: [{ key: "subject", label: "Ref", required: false }],
  },
  {
    id: "image-kit",
    title: "Image Kit",
    description: "A coordinated set of brand images.",
    category: "branding",
    mediaType: "image",
    icon: "layers",
    thumb: thumb("image-kit"),
    promptPlaceholder: "A four-image brand grid for a linen homeware shop…",
    promptRequired: true,
    inputs: [{ key: "subject", label: "Ref", required: false }],
  },
  {
    id: "change-background",
    title: "Change background",
    description: "Keep the subject. Replace only the scene behind them.",
    category: "branding",
    mediaType: "image",
    icon: "image",
    thumb: thumb("change-background"),
    promptPlaceholder: "Soft studio grey, or a sunlit kitchen, or a marble lobby…",
    promptRequired: true,
    inputs: [{ key: "subject", label: "Subject", required: true }],
  },
  {
    id: "change-character",
    title: "Change character",
    description: "Keep the scene and product. Swap in a specific person.",
    category: "branding",
    mediaType: "image",
    icon: "user",
    thumb: thumb("change-character"),
    promptPlaceholder: "Optional: pose, wardrobe, or mood notes…",
    promptRequired: false,
    inputs: [
      { key: "scene", label: "Scene", required: true },
      { key: "character", label: "Character", required: true },
    ],
  },
  {
    id: "product-packaging",
    title: "Packaging",
    description: "Box, label, and unboxing-ready pack shots.",
    category: "branding",
    mediaType: "image",
    icon: "layers",
    thumb: thumb("product-packaging"),
    promptPlaceholder: "A sage-green soap bar carton with foil type, on pale stone…",
    promptRequired: true,
    inputs: [{ key: "subject", label: "Product", required: false }],
  },
  {
    id: "social-thumbnail",
    title: "Thumbnail",
    description: "Clickable covers for YouTube and Reels.",
    category: "branding",
    mediaType: "image",
    icon: "image",
    thumb: thumb("social-thumbnail"),
    promptPlaceholder: "Close-up face plus the product, high contrast, readable at postage-stamp size…",
    promptRequired: true,
    inputs: [{ key: "subject", label: "Ref", required: false }],
  },
  {
    id: "lookbook",
    title: "Lookbook",
    description: "Editorial fashion stills and outfit grids.",
    category: "branding",
    mediaType: "image",
    icon: "shirt",
    thumb: thumb("lookbook"),
    promptPlaceholder: "Linen summer set on a windy rooftop, golden hour, full-length…",
    promptRequired: true,
    inputs: [{ key: "subject", label: "Ref", required: false }],
  },
  {
    id: "headshot",
    title: "Headshot",
    description: "Clean portraits for profiles and press.",
    category: "branding",
    mediaType: "image",
    icon: "camera",
    thumb: thumb("headshot"),
    promptPlaceholder: "Soft window light, navy knit, looking just off camera…",
    promptRequired: true,
    inputs: [{ key: "subject", label: "Person", required: false }],
  },
  {
    id: "welcome-video",
    title: "Golden Hour Coffee",
    description: "A cinematic coffee moment — ready to go, no typing required.",
    category: "storytelling",
    mediaType: "video",
    icon: "sparkles",
    thumb: thumb("welcome-video"),
    promptPlaceholder: "Optional — add your own idea, or just hit Generate",
    promptRequired: false,
    inputs: [],
    modelId: "seedance1_pro_fast",
    resolution: "480p",
  },
];

const SKILL_BY_ID: Record<string, Skill> = Object.fromEntries(SKILLS.map((s) => [s.id, s]));

export function isSkillId(id: string): id is BuiltinSkillId {
  return Object.prototype.hasOwnProperty.call(SKILL_BY_ID, id);
}

export function isPhotoSkillId(id: string): boolean {
  if (!isSkillId(id)) return false;
  const skill = SKILL_BY_ID[id];
  return skill.mediaType === "image" && !skill.openHref;
}

export function isVideoSkillId(id: string): boolean {
  if (!isSkillId(id)) return false;
  const skill = SKILL_BY_ID[id];
  return skill.mediaType === "video" && !skill.openHref;
}

export function isAgentSkillId(id: string): boolean {
  return isPhotoSkillId(id) || isVideoSkillId(id);
}

/** Live catalog row (builtin or custom) that runs on the Agent form. */
export function isAgentSkill(
  skill: Pick<Skill, "openHref" | "comingSoon" | "mediaType">
): boolean {
  return !skill.openHref && !skill.comingSoon && (skill.mediaType === "image" || skill.mediaType === "video");
}

/** Photo omni-form mode the generate-photo route should run for this skill. */
export function skillPhotoMode(
  idOrSkill: string | Pick<Skill, "id" | "inputs" | "mediaType" | "openHref">
): SkillPhotoMode | null {
  const skill = typeof idOrSkill === "string" ? getSkill(idOrSkill) : idOrSkill;
  if (!skill || skill.mediaType !== "image" || skill.openHref) return null;
  if (skill.id === "change-character") return "product";
  if (skill.id === "character-ip") return "character";
  const keys = new Set(skill.inputs.map((slot) => slot.key));
  if (keys.has("scene")) return "product";
  if (keys.has("character") && !keys.has("scene")) return "character";
  return "image";
}

export function getSkill(id: string): Skill | undefined {
  return isSkillId(id) ? SKILL_BY_ID[id] : undefined;
}

export function agentSkills(): Skill[] {
  return SKILLS.filter((s) => isAgentSkillId(s.id));
}

/** Homepage chips under the Agent omni form. Order is display order. */
export const FEATURED_SKILL_IDS: SkillId[] = [
  "high-quality-film",
  "ai-animations",
  "branding-ads",
  "music-videos",
  "trend-inspire",
  "ugc-ads",
  "logo-identity",
];

export function featuredSkills(): Skill[] {
  return FEATURED_SKILL_IDS.map((id) => SKILL_BY_ID[id]);
}

export function skillsInCategory(category: SkillCategoryId): Skill[] {
  return SKILLS.filter((s) => s.category === category);
}

export function skillHref(id: string): string {
  const skill = SKILL_BY_ID[id];
  if (skill?.openHref) return skill.openHref;
  return `/dashboard?skill=${encodeURIComponent(id)}`;
}

/** User-facing title fallback when the prompt is empty. */
export function skillDefaultTitle(id: string, overrideTitle?: string | null): string {
  return overrideTitle?.trim() || SKILL_BY_ID[id]?.title || "Skill";
}

function joinPrompt(parts: Array<string | false | undefined>): string {
  return parts.filter((part): part is string => Boolean(part && part.trim())).join(" ");
}

function fillRecipe(recipe: string, direction: string): string {
  if (!recipe.includes("{prompt}")) {
    return joinPrompt([recipe, direction]);
  }
  return recipe
    .split("\n")
    .map((line) => {
      if (!line.includes("{prompt}")) return line;
      if (!direction) return "";
      return line.replaceAll("{prompt}", direction);
    })
    .filter((line) => line.trim().length > 0)
    .join("\n")
    .trim();
}

const SKILL_RECIPE_DEFAULTS: Record<BuiltinSkillId, string> = {
  "high-quality-film":
    "Cinematic high-quality film look.\nPhotorealistic, filmic color grade, natural motion, shallow depth of field where it helps, anamorphic or spherical cinema lens character, motivated lighting, fine grain, no CGI sheen, no stock-footage look.\nScene: {prompt}",
  "video-clone":
    "The person in the start-frame image is the performer.\nKeep their exact face, hair, skin tone, body, and identity. Do not replace them with a different person.\nNatural body motion that matches the action, photorealistic lighting, handheld or cinematic camera as the scene needs.\nIf no action is given, use natural idle motion, looking toward camera.\nAction and scene: {prompt}",
  "ai-animations":
    "Stylized animated short, not live-action.\nClear art direction, appealing character or object motion, readable silhouettes, cinematic camera moves, rich color, finished animation look — not a slideshow, not photoreal CGI.\nAnimate: {prompt}",
  "ai-story":
    "A short narrative film with a beginning, middle, and end inside one continuous clip.\nEmotional continuity, motivated camera, cinematic lighting, photoreal or grounded live-action look unless the story asks otherwise.\nStory: {prompt}",
  "trend-inspire":
    "Short-form social video in a current, native-feeling visual trend.\nPunchy pacing, satisfying motion, high contrast, platform-native framing, hook in the first second, no watermark, no UI chrome.\nTrend / scene: {prompt}",
  explainer:
    "Clear product or idea explainer clip.\nShow the thing working, simple readable shots, helpful camera, clean lighting, premium but not gimmicky, no text overlays unless they are physically in the scene.\nExplain: {prompt}",
  "character-ip":
    "Character turnaround sheet on a clean studio background.\nSame character shown from multiple consistent angles in one image (front, three-quarter, side, back), matched proportions, outfit, and colors. Design-sheet clarity, not a candid photo.\nCharacter: {prompt}\nIf a reference image is attached, keep that character's identity.",
  "ai-storyboard":
    "Six-panel storyboard sheet from this concept.\nWide establishing, medium, close-up, action, reaction, and a closing beat. Clear panel borders, consistent characters across frames, cinematic lighting, finished illustration — not a photo of a corkboard.\nStory: {prompt}",
  "script-writer":
    "A short cinematic scene that could carry this brief as a filmable moment.\nShow, don't tell: faces, props, and blocking that imply the story. Natural motion, filmic sound-era picture, no on-screen script pages, no title cards.\nBrief: {prompt}",
  "wes-anderson":
    "Wes Anderson inspired short film.\nPerfectly symmetrical centered compositions, pastel production design, planimetric camera, slow push-ins or whip pans, meticulous wardrobe, dry comic timing, miniature-like sets, 35mm character.\nScene: {prompt}",
  anime:
    "Japanese anime short, 2D hand-drawn look, not live-action, not 3D CGI.\nExpressive eyes, readable silhouettes, cinematic camera, painterly backgrounds, sakuga-quality motion on the key action, film grain optional, no photoreal faces.\nScene: {prompt}",
  "stop-motion":
    "Stop-motion / stop-frame craft animation.\nVisible handmade materials (clay, paper, wood, fabric, miniatures), slight pose-to-pose stepping, tactile lighting, miniature-set scale, not smooth CGI, not live-action.\nAnimate: {prompt}",
  "cinematic-trailer":
    "Theatrical movie-trailer shot.\nHigh-drama lighting, epic scale, slow push or crash-in, widescreen cinema language, tension in the blocking, photoreal film grade, no on-screen titles unless they exist physically in the set.\nScene: {prompt}",
  "comic-panels":
    "Finished comic or manga panel still.\nBold inks or screentone, graphic color, clear silhouette, speed lines or panel energy as the scene needs, integrated lettering only if the prompt asks for a word, not a photo of a comic book page on a table.\nPanel: {prompt}\nIf a reference image is attached, keep that character's identity.",
  "branding-ads":
    "Polished product hero commercial.\nLuxury lighting, slow elegant camera, tactile materials, hero product always readable, premium color grade, no clutter, no stock-ad look.\nProduct / story: {prompt}\nIf a start frame is attached, treat it as the product or packshot to feature.",
  "ugc-ads":
    "Native creator-style UGC ad.\nHandheld phone energy, natural room light, a real person talking to camera or demoing the product, casual authentic motion, slightly imperfect framing, not a studio commercial.\nDemo: {prompt}\nIf a start frame is attached, that person or product is what appears on camera.",
  "fashion-try-on":
    "Fashion try-on still.\nPut the product on the model with correct drape, fit, and lighting. Keep the person's identity and the garment's true design. Photoreal, catalog-ready.\nLook: {prompt}\nIf a reference image is attached, that garment or person is what to use.",
  "music-videos":
    "Music-video performance clip.\nRhythm-led cutting energy inside one shot, stylish lighting, performance presence, bold color, in-time body motion, concert or conceptual set, cinematic but musical.\nPerformance: {prompt}",
  "hook-ads":
    "Ultra-short social hook ad.\nPattern interrupt in the first beat, punchy motion, extreme close-up or unexpected action, native 9:16 energy, product readable fast, no watermark, no UI chrome.\nHook: {prompt}\nIf a start frame is attached, that person or product is what appears on camera.",
  unboxing:
    "Satisfying unboxing clip.\nHands, packaging, and product are the heroes. Peel, lift, reveal. Tactile materials, close-up detail, warm practical light, ASMR-adjacent motion, not a talking-head commercial unless asked.\nReveal: {prompt}\nIf a start frame is attached, treat it as the product or pack to open.",
  testimonial:
    "Talking-head testimonial / social-proof clip.\nA real-feeling person speaking to camera, natural room light, slight handheld, authentic face and body language, product nearby if relevant, not a studio spokesperson, no lower-thirds.\nStory: {prompt}\nIf a start frame is attached, that person is the speaker — keep their identity.",
  "food-ads":
    "Food commercial clip.\nSteam, gloss, pour, drizzle, or bite in hero close-up. Appetite lighting, slow sensual camera, droplets and texture, kitchen or restaurant set, no people talking unless asked.\nDish / action: {prompt}\nIf a start frame is attached, that dish or product is what we shoot.",
  "logo-identity":
    "Original logo and brand-identity still.\nClean vector-like mark and lockup on a simple background, distinctive, professional, not a photograph of a logo in a street, not clipart, not a watermarked mock, not existing famous brands.\nBrand: {prompt}\nIf a reference image is attached, use it only for color, motif, or style cues.",
  "product-listing":
    "Marketplace-ready product listing photo.\nTrue-to-life product, even lighting, clean sweep or tasteful lifestyle set, sharp detail, accurate materials, no heavy CGI sheen, listing-page crop.\nProduct: {prompt}\nIf a reference image is attached, keep that exact product — shape, logo, color, and details.",
  poster:
    "Campaign poster still.\nStrong typography integrated in the design, bold composition, print-ready hierarchy, product or subject featured clearly, finished poster art not a photo of a poster on a wall unless asked.\nPoster: {prompt}\nIf a reference image is attached, feature that subject or product.",
  "image-kit":
    "A coordinated brand image kit as one layout.\nA clean grid of 4 to 6 matching stills that share palette, lighting, and styling (hero, detail, lifestyle, texture). Cohesive campaign, not random collages, not screenshots.\nBrand world: {prompt}\nIf a reference image is attached, use it as the brand's visual anchor.",
  "change-background":
    "Edit the attached reference image.\nKeep the subject identical — face, body, clothing, pose, product, and proportions must not change.\nReplace only the background / environment.\nNew background: {prompt}\nIf no background is specified, use a clean, professional studio background.\nPhotorealistic composite, matching light direction and color temperature on the subject, no cutout edges.",
  "change-character":
    "The FIRST reference image is the scene (setting, product, composition).\nThe SECOND reference image is the exact person to use as the model.\nUse that exact person — preserve their face, hairstyle, skin tone, and body type precisely; do NOT replace them with a different person.\nKeep the scene, product, colors, logos, and composition from the first image; only replace the person.\nCreative direction from the user: {prompt}\nPhotorealistic, seamless composite, matching lighting.",
  "product-packaging":
    "Product packaging design still.\nThe pack is the hero: structure, label, typography, and finish (paper, foil, plastic, glass) must read clearly. Studio or tasteful lifestyle set, print-ready, not a crumpled mock on a messy desk unless asked.\nPack: {prompt}\nIf a reference image is attached, keep that product's identity on the pack.",
  "social-thumbnail":
    "High-impact thumbnail or cover still for YouTube, Reels, or Shorts.\nReadable at tiny size: one clear face or product, strong contrast, simple background, bold expression or object. Integrated type only if the prompt asks. Not a screenshot of a video player, no YouTube UI chrome.\nCover: {prompt}\nIf a reference image is attached, feature that person or product.",
  lookbook:
    "Fashion lookbook still.\nEditorial lighting, full outfit readable, strong pose and styling, magazine-quality crop, fabric texture, not a messy fitting-room mirror selfie.\nLook: {prompt}\nIf a reference image is attached, keep that garment or person.",
  headshot:
    "Professional portrait headshot.\nSharp eyes, flattering light (window or soft key), clean or softly blurred backdrop, natural skin, shoulders-up crop, press-ready, not a selfie, not a character turnaround sheet.\nSubject: {prompt}\nIf a reference image is attached, keep that exact person's face and identity.",
  // Deliberately has NO {prompt} token — this is the one recipe meant to run
  // with zero user input (promptRequired: false above). A fully fixed scene,
  // not a template, so the free first generation needs no typing at all.
  "welcome-video":
    "A warm, cinematic five-second everyday moment: golden-hour light spilling across a minimalist wooden table, a steaming ceramic cup of coffee catching the light as gentle steam curls upward, slow camera push-in, shallow depth of field, soft warm color grade, gentle ambient motion. Inviting, aspirational, photorealistic.",
};

export function defaultSkillRecipe(id: string): string {
  return (isSkillId(id) ? SKILL_RECIPE_DEFAULTS[id] : undefined) ?? "{prompt}";
}

/**
 * Provider prompt for a skill. The user's text stays the stored `prompt` /
 * `userPrompt`; this string is what the model sees.
 * Pass `recipeOverride` from skill_configs when an admin has edited the recipe.
 */
export function assembleSkillPrompt(
  skillId: string,
  userPrompt?: string,
  recipeOverride?: string | null
): string {
  const direction = (userPrompt ?? "").trim();
  const recipe = recipeOverride?.trim() || defaultSkillRecipe(skillId);
  return fillRecipe(recipe, direction) || direction;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

/** ponytail: runnable without a DB — fails if the catalog or hrefs drift. */
export function skillsSelfCheck(): void {
  assert(SKILLS.length === SKILL_IDS.length, "every SKILL_IDS entry must have a catalog row");
  for (const id of SKILL_IDS) {
    const skill = getSkill(id);
    assert(!!skill, `missing catalog row for ${id}`);
    assert(skill!.title.trim().length > 0, `${id} needs a title`);
    assert(skill!.thumb === `/skills/${id}.jpg`, `${id} thumb should be a local public/skills file`);
    assert(defaultSkillRecipe(id).trim().length > 0, `${id} needs a default recipe`);
  }
  for (const skill of SKILLS) {
    if (skill.openHref) {
      assert(!isAgentSkillId(skill.id), `${skill.id} is a studio hand-off, not an agent recipe`);
      continue;
    }
    assert(!skill.comingSoon, `${skill.id} should be live`);
    assert(isAgentSkillId(skill.id), `${skill.id} should run on the agent form`);
    if (skill.mediaType === "video") {
      assert(isVideoSkillId(skill.id), `${skill.id} is a video recipe`);
      assert(!isPhotoSkillId(skill.id), `${skill.id} is not a photo recipe`);
    } else {
      assert(isPhotoSkillId(skill.id), `${skill.id} is a photo recipe`);
      assert(!isVideoSkillId(skill.id), `${skill.id} is not a video recipe`);
      assert(skillPhotoMode(skill.id) !== null, `${skill.id} needs a photo mode`);
    }
    if (skill.promptRequired) {
      assert(skill.promptPlaceholder.trim().length > 0, `${skill.id} needs a placeholder`);
    }
  }
  assert(isPhotoSkillId("change-background") && isPhotoSkillId("change-character"), "photo skills");
  assert(isPhotoSkillId("logo-identity"), "logo is a live photo skill");
  assert(isVideoSkillId("high-quality-film"), "video skill");
  assert(isVideoSkillId("ai-animations"), "animations is a live video skill");
  assert(!isPhotoSkillId("high-quality-film"), "film is not a photo skill");
  assert(skillPhotoMode("character-ip") === "character", "character IP uses character mode");
  assert(skillPhotoMode("change-character") === "product", "change-character uses product mode");
  assert(skillPhotoMode("logo-identity") === "image", "logo uses image mode");
  assert(isVideoSkillId("anime") && isVideoSkillId("hook-ads"), "new video skills");
  assert(isPhotoSkillId("comic-panels") && isPhotoSkillId("headshot"), "new photo skills");
  assert(skillPhotoMode("headshot") === "image", "headshot uses image mode");
  assert(getSkill("hook-ads")?.badge === "new", "hook-ads is marked New");
  for (const id of FEATURED_SKILL_IDS) {
    assert(isAgentSkillId(id), `featured skill must run on the agent form: ${id}`);
  }
  assert(getSkill("trend-inspire")?.badge === "new", "trend-inspire is the New featured skill");
  assert(skillHref("high-quality-film") === "/dashboard?skill=high-quality-film", "agent href");
  assert(skillHref("ai-storyboard").startsWith("/tools/photo-v2"), "storyboard hand-off");
  assert(skillHref("my-custom-skill") === "/dashboard?skill=my-custom-skill", "custom skill href");
  assert(isSkillSlug("high-quality-film") && isSkillSlug("my-custom-skill"), "valid slugs");
  assert(!isSkillSlug("My Skill") && !isSkillSlug("-bad") && !isSkillSlug("a"), "invalid slugs");
  assert(slugifySkillId("My Cool Skill") === "my-cool-skill", "slugify title");
  assert(isAgentSkill(getSkill("logo-identity")!), "logo is an agent skill");
  assert(!isAgentSkill(getSkill("ai-storyboard")!), "storyboard is a hand-off");
  assert(
    assembleSkillPrompt("change-background", "marble lobby").includes("marble lobby"),
    "background prompt includes user direction"
  );
  assert(
    assembleSkillPrompt("high-quality-film", "rainy alley").includes("rainy alley"),
    "film prompt includes scene"
  );
  assert(
    assembleSkillPrompt("ai-animations", "a cat dances").includes("a cat dances"),
    "animation prompt includes user direction"
  );
  assert(
    assembleSkillPrompt("ai-animations", "a cat dances").length > "a cat dances".length,
    "animation prompt wraps the user text"
  );
}

if (require.main === module) {
  skillsSelfCheck();
  console.log("skillsSelfCheck: ok");
}
