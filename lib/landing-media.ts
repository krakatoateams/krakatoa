/**
 * Background clips shared by the landing hero and the auth screens.
 *
 * Served from Cloudflare R2. Supabase Storage is currently returning 402 under
 * `exceed_egress_quota`, and R2 has no egress cost, so the clips live there.
 *
 * Caveat: `*.r2.dev` is Cloudflare's managed dev domain — rate-limited and
 * uncached, which is what caused intermittently blank clips the last time these
 * were served from it. The durable fix is a custom domain on the bucket
 * (e.g. cdn.kelolako.com), which lifts the rate limit and puts the CDN in
 * front. Point NEXT_PUBLIC_LANDING_VIDEO_BASE at it once DNS is on Cloudflare.
 */
const DEFAULT_VIDEO_BASE = "https://pub-30197c9faf284e5e852ce7d61364972c.r2.dev";

export const LANDING_VIDEO_BASE = (
  process.env.NEXT_PUBLIC_LANDING_VIDEO_BASE || DEFAULT_VIDEO_BASE
).replace(/\/+$/, "");

export const LANDING_VIDEO_FILES = [
  "Badminton (GPT).mp4",
  "Car Racing 1 (Seedence).mp4",
  "Car Racing 2 (seedence).mp4",
  "Dinosaur (Kling).mp4",
];

export const LANDING_VIDEO_SRCS = LANDING_VIDEO_FILES.map(
  (name) => `${LANDING_VIDEO_BASE}/${encodeURIComponent(name)}`
);

/**
 * Showreel for the /hello hero: one clip per model, so the model strip doubles
 * as the playlist selector.
 *
 * Kling and Seedance map to the clips actually generated with them. "Badminton
 * (GPT)" has no counterpart in the marketed model list, so it stands in for
 * Nano Banana — swap in a real Nano Banana clip when there is one. The fourth
 * file ("Car Racing 2") is a second Seedance racing clip and is left out here;
 * it still plays in the full rotation on `/` and the auth screens.
 */
export const LANDING_SHOWREEL: { model: string; src: string }[] = [
  { model: "Nano Banana 2", file: "Badminton (GPT).mp4" },
  { model: "Kling 3", file: "Dinosaur (Kling).mp4" },
  { model: "Seedance 2", file: "Car Racing 1 (Seedence).mp4" },
].map(({ model, file }) => ({
  model,
  src: `${LANDING_VIDEO_BASE}/${encodeURIComponent(file)}`,
}));
