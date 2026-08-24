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
   * Generation prompt that produced the clip. Viral templates deep-link this
   * into Image to video so the user remakes the scene with their own photo.
   */
  prompt?: string;
};

/** Motion-control handoff for try-on templates (driving video). */
export function tryOnTemplateHref(videoUrl: string): string {
  return `/tools/video?type=motion_control&templateVideo=${encodeURIComponent(videoUrl)}`;
}

/**
 * Viral-template handoff: Image to video with the template's prompt prefilled.
 * The user attaches their own photo as the start frame — we do not copy pose
 * from the showcase clip.
 */
export function viralTemplateHref(prompt: string): string {
  const trimmed = prompt.trim();
  if (!trimmed) return "/tools/video?type=image2video";
  return `/tools/video?type=image2video&prompt=${encodeURIComponent(trimmed)}`;
}

/** Public assets under /viral-templates/ only — never fetch arbitrary URLs. */
export function isViralTemplateAssetPath(path: string): boolean {
  return path.startsWith("/viral-templates/") && !path.includes("..");
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
 * in `public/viral-templates/` and write the Image-to-video prompt that should
 * prefill when the user clicks Use template. Describe the scene and motion,
 * not the person in the showcase still; their start photo supplies identity.
 */
const VIRAL_DIR = "/viral-templates";
const VIRAL_REFERENCE = `${VIRAL_DIR}/reference.png`;

const VIRAL_CATALOG: Array<{
  file: string;
  prompt: string;
  /** Override if this clip was made from a different still. */
  referenceImageUrl?: string;
}> = [
  {
    file: "kelolako_viral_videos_00001.mp4",
    prompt:
      "Cinematic vertical shot of the person from the start frame sitting in a helicopter cockpit at golden hour, smiling as they look out the side window toward the horizon, one hand on the cyclic stick, black harness across their chest, warm sunset light on their face, airfield and hills outside the windows, slow natural movement, 9:16.",
  },
  {
    file: "kelolako_viral_videos_00002.mp4",
    prompt:
      "Vertical shot of the person from the start frame bouldering on an outdoor climbing wall, athletic side profile leaning back from the wall and reaching for colorful holds, crash pad below, sunny park and blue sky behind them, natural climbing motion, 9:16.",
  },
  {
    file: "kelolako_viral_videos_00003.mp4",
    prompt:
      "Cinematic vertical shot of the person from the start frame driving a red convertible with the top down through a modern city at golden hour, both hands on the steering wheel, tan leather seats, dense skyscraper skyline behind them, wind in their hair, 9:16.",
  },
  {
    file: "kelolako_viral_videos_00004.mp4",
    prompt:
      "Vertical travel montage of the person from the start frame walking toward camera through a grand glass-and-steel arched transit hall with a backpack, then standing at a neon-lit Tokyo crossing at night leaning on a metal railing, then looking up at a vermilion torii gate in a sunlit shrine forest, cinematic, 9:16.",
  },
  {
    file: "kelolako_viral_videos_00005.mp4",
    prompt:
      "Cinematic vertical shot pulling from Earth in space down into a dense night city, camera diving along a glowing multi-lane highway packed with light trails, skyscrapers lining both sides, photorealistic, 9:16.",
  },
  {
    file: "kelolako_viral_videos_00006.mp4",
    prompt:
      "Vertical shot of the person from the start frame walking through a modern city at golden hour, looking up at a curved glass skyscraper reflecting the skyline, sidewalk in the foreground, warm late-afternoon light, cinematic, 9:16.",
  },
];

export const VIRAL_TEMPLATES: TrendingTemplate[] = VIRAL_CATALOG.map((item) => ({
  id: item.file,
  videoUrl: `${VIRAL_DIR}/${item.file}`,
  referenceImageUrl: item.referenceImageUrl ?? VIRAL_REFERENCE,
  prompt: item.prompt,
}));
