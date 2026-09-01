import { LANDING_VIDEO_BASE } from "@/lib/landing-media";

/**
 * Clips for the dashboard "Trending templates" carousel.
 *
 * Curated showcase content, identical for every user — so it lives here rather
 * than in Postgres. It used to be the `trending_templates` table, but with no
 * admin UI behind it, editing meant hand-writing UPDATEs in the SQL Editor;
 * that is not easier than editing this array, and it cost a table, an API
 * route, and a fetch on every dashboard load. The table still exists, unused.
 *
 * Served from R2 behind cdn.kelolako.com, not Supabase Storage: the carousel is
 * ~12 MB and every card autoplays, which made it a real chunk of the Storage
 * egress bill.
 */
const BASE = "https://cdn.kelolako.com/trending-template-1";

/**
 * Motion-control carousel clips. `preview` is shown in the UI (often webm for size);
 * `generation` is the MP4 sent to Replicate / stored refs (provider-safe).
 */
const MOTION_CLIP_CATALOG: Array<{ preview: string; generation?: string }> = [
  { preview: "kelolako_motion1.webm", generation: "kelolako_motion1_compressed.mp4" },
  { preview: "5fcbc237-7bfc-4275-8c8c-6c0c80eff401-dcb267808091d553.mp4" },
  { preview: "9f4320b6-27ce-47dc-be0d-ebc98b232fef-4618b39cd3aedf6a.mp4" },
  { preview: "eb68f0d4-6a2e-473b-ad39-a34c7e8b1d00-7fd7325a427ac5a7.mp4" },
  { preview: "f6b20b46-4a5f-4514-91cf-c65d5ad10c82-bf553f1b0fd58f61.mp4" },
];

export type TrendingTemplate = {
  id: string;
  /** Preview URL (carousel + composer thumbnail); may be webm for bandwidth. */
  videoUrl?: string;
  /**
   * MP4 (or provider-safe) URL for generation when `videoUrl` is a lighter preview
   * format. Defaults to `videoUrl` when omitted.
   */
  generationVideoUrl?: string;
  /** Still preview when the template is a photo (product try-on). */
  imageUrl?: string;
  /** Optional source still shown on hover — the image this clip was made from. */
  referenceImageUrl?: string;
  /** Product try-on: jacket/product file preloaded into Photo studio. */
  productImageUrl?: string;
  /** Product try-on: optional character/model file. */
  characterImageUrl?: string;
  /**
   * Generation prompt baked into the Viral Template composer (not shown to the user).
   * Character templates tag the user's upload as [Image1] and spell out multi-shot beats.
   */
  prompt?: string;
  /** Viral templates: human-readable name shown in the composer. */
  title?: string;
  /** Viral templates: number of sequential shots/beats in the clip. */
  shotCount?: number;
};

/** Text-to-video handoff for dashboard template cards. */
export function textToVideoTemplateHref(prompt?: string): string {
  const trimmed = prompt?.trim();
  if (!trimmed) return "/tools/video?type=text2video";
  return `/tools/video?type=text2video&prompt=${encodeURIComponent(trimmed)}`;
}

/** Motion-control handoff for dashboard motion-control carousel clips. */
export function tryOnTemplateHref(videoUrl: string): string {
  return `/tools/video?type=motion_control&templateVideo=${encodeURIComponent(videoUrl)}`;
}

/**
 * Viral-template handoff: dedicated Viral Template composer with the showcase
 * clip locked and the generation prompt baked in — user only supplies a character.
 */
export function viralTemplateHref(templateId: string): string {
  return `/tools/video?type=viral_template&viralTemplate=${encodeURIComponent(templateId)}`;
}

export function getViralTemplate(templateId: string): TrendingTemplate | undefined {
  return (
    VIRAL_TEMPLATES.find((t) => t.id === templateId) ??
    PRODUCT_REVIEW_TEMPLATES.find((t) => t.id === templateId)
  );
}

export function isViralTemplateId(templateId: string): boolean {
  return getViralTemplate(templateId) !== undefined;
}

/** Same composer as viral templates — separate dashboard carousel only. */
export function productReviewTemplateHref(templateId: string): string {
  return viralTemplateHref(templateId);
}

/** @deprecated Use viralTemplateHref(templateId) — image2video prompt links are retired. */
export function viralTemplateImage2VideoHref(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return "/tools/video?type=image2video";
  return `/tools/video?type=image2video&prompt=${encodeURIComponent(trimmed)}`;
}

/** Public assets under bundled template folders only — never fetch arbitrary URLs. */
export function isViralTemplateAssetPath(path: string): boolean {
  return (
    (path.startsWith("/viral-templates/") || path.startsWith("/product-review-templates/")) &&
    !path.includes("..")
  );
}

/** Absolute URL for a bundled viral-template asset (browser / UI). */
export function absoluteViralTemplateAssetUrl(assetPath: string, origin: string): string | null {
  const trimmed = assetPath.trim();
  if (!isViralTemplateAssetPath(trimmed)) return null;
  return `${origin.replace(/\/$/, "")}${trimmed}`;
}

/** Display label for a viral template card or composer chip. */
export function viralTemplateLabel(template: Pick<TrendingTemplate, "id" | "title">): string {
  if (template.title?.trim()) return template.title.trim();
  return template.id.replace(/^kelolako_viral_videos_/, "").replace(/\.mp4$/, "");
}

/**
 * Product try-on handoff: Photo studio with the template's product (and
 * optional character) preloaded. The user can swap the person and generate.
 */
export function productTryOnHref(opts: {
  productUrl: string;
  characterUrl?: string;
  prompt?: string;
}): string {
  const q = new URLSearchParams({ type: "product-tryon", product: opts.productUrl });
  if (opts.characterUrl) q.set("character", opts.characterUrl);
  if (opts.prompt?.trim()) q.set("prompt", opts.prompt.trim());
  return `/tools/photo-v2?${q.toString()}`;
}

export const TRENDING_TEMPLATES: TrendingTemplate[] = MOTION_CLIP_CATALOG.map(
  ({ preview, generation }) => {
    const videoUrl = `${BASE}/${preview}`;
    const generationVideoUrl = `${BASE}/${generation ?? preview}`;
    return {
      id: preview,
      videoUrl,
      ...(generationVideoUrl !== videoUrl ? { generationVideoUrl } : {}),
    };
  }
);

/**
 * Resolve the provider/Supabase-safe motion reference URL from a preview URL
 * (deep-link query param or catalog `videoUrl`). Preview webm stays UI-only.
 */
export function motionControlGenerationVideoUrl(previewUrl: string): string {
  const normalized = previewUrl.trim();
  const match = TRENDING_TEMPLATES.find((t) => t.videoUrl === normalized);
  if (match?.generationVideoUrl) return match.generationVideoUrl;
  if (/\.webm$/i.test(normalized)) {
    return normalized.replace(/\.webm$/i, "_compressed.mp4");
  }
  return normalized;
}

/**
 * Dashboard "Photo try-on" carousel (left column next to Video try-on).
 * Add a folder under `public/viral-templates/` with product / character /
 * result stills, then append one object here.
 */
const PRODUCT_TRYON_CATALOG: Array<{
  id: string;
  dir: string;
  product: string;
  character: string;
  result: string;
  prompt: string;
}> = [
  {
    id: "jacket-00001",
    dir: "/viral-templates/Jacket",
    product: "product.webp",
    character: "character.png",
    result: "result.png",
    prompt:
      "Studio full-body photo of the person wearing this cream bomber jacket with the black corduroy collar and red chest emblem, jacket unzipped over a light shirt, dark brown trousers, beige seamless backdrop, even studio light.",
  },
  {
    id: "shoes-00001",
    dir: "/viral-templates/Shoes",
    product: "product.png",
    character: "character.png",
    result: "result.png",
    prompt:
      "Full-body photo of the person walking on white marble wearing these pale grey square-toe ankle boots with a center-front zipper, white tank top, blue denim midi skirt, luxury marble interior, even fashion-studio light.",
  },
  {
    id: "watch-00001",
    dir: "/viral-templates/Watch",
    product: "product.webp",
    character: "character.png",
    result: "result.png",
    prompt:
      "Studio photo of the person leaning against a beige pillar wearing this oval crystal-bezel watch with a burgundy leather strap on the left wrist, white tank top, olive trousers, brown belt, minimalist interior, even fashion-studio light.",
  },
];

export const VIRTUAL_PRODUCT_TRYON_TEMPLATES: TrendingTemplate[] = PRODUCT_TRYON_CATALOG.map(
  (item) => ({
    id: item.id,
    imageUrl: `${item.dir}/${item.result}`,
    referenceImageUrl: `${item.dir}/${item.product}`,
    productImageUrl: `${item.dir}/${item.product}`,
    characterImageUrl: `${item.dir}/${item.character}`,
    prompt: item.prompt,
  })
);

/**
 * Dashboard "Viral templates" carousel.
 *
 * Add a new card here — one object per clip. Put the mp4 (and optional webm)
 * in `public/viral-templates/` and append one object to VIRAL_CATALOG. The
 * generation prompt is applied automatically in the Viral Template composer.
 */
const VIRAL_DIR = "/viral-templates";
/** Default locked start frame for viral-template i2v (scene composition). */
const VIRAL_START_FRAME = `${VIRAL_DIR}/reference.png`;
/** Carousel hint — user supplies their own character; not the locked i2v start frame. */
const VIRAL_CHARACTER_THUMB = `${VIRAL_DIR}/character-thumb.webp`;

type ViralCatalogEntry = {
  file: string;
  title: string;
  /** When true, [Image1] is the on-screen subject (user's uploaded character). */
  usesCharacter: boolean;
  /** One entry per on-screen beat; multiple entries = multi-shot template. */
  shots: string[];
  /** Locked i2v start frame when different from the shared default still. */
  startFrameImageUrl?: string;
  /** Product review carousel: product still beside the character thumb. */
  productThumb?: string;
};

function characterIdentityBlock(): string {
  return [
    "CHARACTER REFERENCE: The user uploaded a photo of the person who must appear on screen — tagged [Image1].",
    "[Image1] is ONLY the character identity (face, hair, skin tone, body shape).",
    "Never treat [Image1] as the background, location, environment, or template scene plate.",
    "Preserve the same person from [Image1] in every shot where they appear.",
  ].join(" ");
}

function templateSceneBlock(): string {
  return "TEMPLATE SCENE: The locked start-frame image defines environment and composition — place the character from [Image1] into this template scene, not the reverse.";
}

function buildSingleShotBlock(shot: string): string {
  return `${shot} Single continuous shot. Vertical 9:16 cinematic framing.`;
}

function buildMultiShotBlock(shots: string[], usesCharacter: boolean): string {
  const shotCount = shots.length;
  const lines = [
    `MULTI-SHOT STRUCTURE: ${shotCount}-shot vertical video — play all ${shotCount} shots in order as distinct beats.`,
    "Cut or transition clearly between shots; do not merge unrelated beats into one uninterrupted take unless a shot explicitly says so.",
  ];
  if (usesCharacter) {
    lines.push(
      "Every shot that includes a person must feature the same character from [Image1] — same face, hair, and body identity."
    );
  }
  shots.forEach((shot, index) => {
    const role =
      index === 0 ? "opening" : index === shotCount - 1 ? "closing" : `beat ${index + 1}`;
    lines.push(`Shot ${index + 1} (${role}): ${shot}`);
  });
  lines.push("Maintain vertical 9:16 framing throughout the full sequence.");
  return lines.join(" ");
}

function buildTemplatePrompt(
  label: "Viral template" | "Product review template",
  entry: ViralCatalogEntry
): string {
  const templateId = entry.file.replace(/\.mp4$/, "");
  const header = `${label} "${entry.title}" (template id: ${templateId}).`;
  const parts = [header];

  if (entry.usesCharacter) {
    parts.push(characterIdentityBlock(), templateSceneBlock());
  }

  const shots = entry.shots.map((s) => s.trim()).filter(Boolean);
  if (shots.length === 0) {
    parts.push("Cinematic vertical 9:16.");
  } else if (shots.length === 1) {
    parts.push(buildSingleShotBlock(shots[0]));
  } else {
    parts.push(buildMultiShotBlock(shots, entry.usesCharacter));
  }

  return parts.filter(Boolean).join(" ");
}

function buildViralTemplatePrompt(entry: ViralCatalogEntry): string {
  return buildTemplatePrompt("Viral template", entry);
}

function buildProductReviewTemplatePrompt(entry: ViralCatalogEntry): string {
  return buildTemplatePrompt("Product review template", entry);
}

const VIRAL_CATALOG: ViralCatalogEntry[] = [
  {
    file: "kelolako_viral_videos_00001.mp4",
    title: "Helicopter golden hour",
    usesCharacter: true,
    shots: [
      "Cinematic shot of the person in [Image1] sitting in a helicopter cockpit at golden hour, smiling as they look out the side window toward the horizon, one hand on the cyclic stick, black harness across their chest, warm sunset light on their face, airfield and hills outside the windows, slow natural movement.",
    ],
  },
  {
    file: "kelolako_viral_videos_00002.mp4",
    title: "Outdoor bouldering",
    usesCharacter: true,
    shots: [
      "Vertical shot of the person in [Image1] bouldering on an outdoor climbing wall, athletic side profile leaning back from the wall and reaching for colorful holds, crash pad below, sunny park and blue sky behind them, natural climbing motion.",
    ],
  },
  {
    file: "kelolako_viral_videos_00003.mp4",
    title: "Convertible city drive",
    usesCharacter: true,
    shots: [
      "Cinematic multiple shots of the person in [Image1] driving a red convertible with the top down through a modern city at golden hour, both hands on the steering wheel, tan leather seats, dense skyscraper skyline behind them, wind in their hair.",
    ],
  },
  {
    file: "kelolako_viral_videos_00004.mp4",
    title: "Travel montage",
    usesCharacter: true,
    shots: [
      "the person in [Image1] walking toward camera through a grand glass-and-steel arched transit hall with a backpack",
      "the person in [Image1] standing at a neon-lit Tokyo crossing at night, leaning on a metal railing",
      "the person in [Image1] looking up at a vermilion torii gate in a sunlit shrine forest",
    ],
  },
  {
    file: "kelolako_viral_videos_00005.mp4",
    title: "Earth to city dive",
    usesCharacter: false,
    shots: [
      "pull back from Earth in space showing the planet's curvature against the black sky",
      "camera dives from orbit into a dense night city, skyscrapers rushing toward the lens",
      "speeding along a glowing multi-lane highway packed with light trails, skyscrapers lining both sides, photorealistic",
    ],
  },
  {
    file: "kelolako_viral_videos_00006.mp4",
    title: "Urban skyline walk",
    usesCharacter: true,
    shots: [
      "Vertical shot of the person in [Image1] walking through a modern city at golden hour, looking up at a curved glass skyscraper reflecting the skyline, sidewalk in the foreground, warm late-afternoon light.",
    ],
  },
];

export const VIRAL_TEMPLATES: TrendingTemplate[] = VIRAL_CATALOG.map((item) => ({
  id: item.file,
  title: item.title,
  shotCount: item.shots.length,
  videoUrl: `${VIRAL_DIR}/${item.file}`,
  characterImageUrl: VIRAL_CHARACTER_THUMB,
  referenceImageUrl: item.startFrameImageUrl ?? VIRAL_START_FRAME,
  prompt: buildViralTemplatePrompt(item),
}));

/**
 * Dashboard "Product review templates" carousel (beside Viral templates).
 *
 * Clips live in the `video-banner` R2 bucket under `Product review/` and are
 * served from cdn.kelolako.com (same pattern as landing hero clips). Append one
 * object to PRODUCT_REVIEW_CATALOG per file uploaded there. Opens the Viral
 * Template composer on Use.
 */
const PRODUCT_REVIEW_CDN_DIR = "Product review";

function productReviewCdnUrl(file: string): string {
  const dir = PRODUCT_REVIEW_CDN_DIR.split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `${LANDING_VIDEO_BASE}/${dir}/${encodeURIComponent(file)}`;
}

const PRODUCT_REVIEW_DIR = "/product-review-templates";

const PRODUCT_REVIEW_CATALOG: ViralCatalogEntry[] = [
  {
    file: "kelolako_product_r1_compressed.webm",
    title: "Product review 1",
    usesCharacter: true,
    productThumb: `${PRODUCT_REVIEW_DIR}/r1-product.webp`,
    shots: [
      "Vertical UGC product review shot of the person in [Image1] holding the product toward camera, natural window light, authentic handheld framing.",
    ],
  },
  {
    file: "kelolako_product_r4_compressed.webm",
    title: "Product review 4",
    usesCharacter: true,
    productThumb: `${PRODUCT_REVIEW_DIR}/r4-product.webp`,
    shots: [
      "Vertical UGC product review of the person in [Image1] presenting the product with enthusiastic delivery, casual home setting, authentic creator-style framing.",
    ],
  },
  {
    file: "kelolako_product_r3_compressed.webm",
    title: "Product review 3",
    usesCharacter: true,
    productThumb: `${PRODUCT_REVIEW_DIR}/r3-product.webp`,
    shots: [
      "Vertical UGC close-up product review with the person in [Image1] showing product details to camera, soft natural light, authentic testimonial energy.",
    ],
  },
  {
    file: "kelolako_product_r2_compressed.webm",
    title: "Product review 2",
    usesCharacter: true,
    productThumb: `${PRODUCT_REVIEW_DIR}/r2-product.webp`,
    shots: [
      "Vertical UGC product review of the person in [Image1] demonstrating the product with confident gestures, clean indoor background, social-native pacing.",
    ],
  },
];

export const PRODUCT_REVIEW_TEMPLATES: TrendingTemplate[] = PRODUCT_REVIEW_CATALOG.map(
  (item) => ({
    id: item.file,
    title: item.title,
    shotCount: item.shots.length,
    videoUrl: productReviewCdnUrl(item.file),
    characterImageUrl: VIRAL_CHARACTER_THUMB,
    productImageUrl: item.productThumb,
    referenceImageUrl: item.startFrameImageUrl ?? VIRAL_START_FRAME,
    prompt: buildProductReviewTemplatePrompt(item),
  })
);
