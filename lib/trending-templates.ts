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

/** Carousel order. */
const FILES = [
  "2c90d936-07e9-4f0e-a0eb-fb7cdbf48228-8b28bde63ae889a5.mp4",
  "5fcbc237-7bfc-4275-8c8c-6c0c80eff401-dcb267808091d553.mp4",
  "71d459a3-7025-459b-82fb-8ba29008ba32-1c64ea186d659820.mp4",
  "9f4320b6-27ce-47dc-be0d-ebc98b232fef-4618b39cd3aedf6a.mp4",
  "eb68f0d4-6a2e-473b-ad39-a34c7e8b1d00-7fd7325a427ac5a7.mp4",
  "f6b20b46-4a5f-4514-91cf-c65d5ad10c82-bf553f1b0fd58f61.mp4",
];

export type TrendingTemplate = {
  id: string;
  videoUrl?: string;
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
  return VIRAL_TEMPLATES.find((t) => t.id === templateId);
}

export function isViralTemplateId(templateId: string): boolean {
  return VIRAL_TEMPLATES.some((t) => t.id === templateId);
}

/** @deprecated Use viralTemplateHref(templateId) — image2video prompt links are retired. */
export function viralTemplateImage2VideoHref(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return "/tools/video?type=image2video";
  return `/tools/video?type=image2video&prompt=${encodeURIComponent(trimmed)}`;
}

/** Public assets under /viral-templates/ only — never fetch arbitrary URLs. */
export function isViralTemplateAssetPath(path: string): boolean {
  return path.startsWith("/viral-templates/") && !path.includes("..");
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

export const TRENDING_TEMPLATES: TrendingTemplate[] = FILES.map((file) => ({
  id: file,
  videoUrl: `${BASE}/${file}`,
}));

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

type ViralCatalogEntry = {
  file: string;
  title: string;
  /** When true, [Image1] is the on-screen subject (user's uploaded character). */
  usesCharacter: boolean;
  /** One entry per on-screen beat; multiple entries = multi-shot template. */
  shots: string[];
  /** Locked i2v start frame when different from the shared default still. */
  startFrameImageUrl?: string;
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

function buildViralTemplatePrompt(entry: ViralCatalogEntry): string {
  const templateId = entry.file.replace(/\.mp4$/, "");
  const header = `Viral template "${entry.title}" (template id: ${templateId}).`;
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
  referenceImageUrl: item.startFrameImageUrl ?? VIRAL_START_FRAME,
  prompt: buildViralTemplatePrompt(item),
}));
