/**
 * Background clips shared by the landing hero and the auth screens.
 *
 * Served from Cloudflare R2 over the bucket's custom domain. Supabase Storage
 * returned 402 `exceed_egress_quota`, and R2 has no egress cost, so the clips
 * live there.
 *
 * The custom domain replaced the `pub-*.r2.dev` managed dev URL, which is
 * rate-limited and bypasses the CDN — that was the cause of intermittently
 * blank clips. The dev URL is now disabled on the bucket, so this must stay a
 * host that is actually enabled or every hero video 401s.
 *
 * NEXT_PUBLIC_LANDING_VIDEO_BASE overrides it, but note it is inlined at build
 * time: setting it in Vercel does nothing until the next deploy.
 */
const DEFAULT_VIDEO_BASE = "https://cdn.kelolako.com";

export const LANDING_VIDEO_BASE = (
  process.env.NEXT_PUBLIC_LANDING_VIDEO_BASE || DEFAULT_VIDEO_BASE
).replace(/\/+$/, "");

/**
 * The `-optimized` re-encodes, not the original uploads sitting beside them in
 * the same bucket: 6.5 MB for the set against 22 MB. This is the hero, so page
 * weight beats fidelity.
 */
export const LANDING_VIDEO_FILES = [
  "Badminton (GPT)-optimized.mp4",
  "Car Racing 1 (Seedence)-optimized.mp4",
  "Car Racing 2 (seedence)-optimized.mp4",
  "Dinosaur (Kling)-optimized.mp4",
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
  { model: "Nano Banana 2", file: "Badminton (GPT)-optimized.mp4" },
  { model: "Kling 3", file: "Dinosaur (Kling)-optimized.mp4" },
  { model: "Seedance 2", file: "Car Racing 1 (Seedence)-optimized.mp4" },
].map(({ model, file }) => ({
  model,
  src: `${LANDING_VIDEO_BASE}/${encodeURIComponent(file)}`,
}));
