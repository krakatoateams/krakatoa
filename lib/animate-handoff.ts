import { CREATION_TOOLS, type CreationHistoryItem, type CreationTool } from "./creations";

/**
 * Photo → video hand-off. One place owns both halves of the contract so the CTA
 * in the Photo studio and the one in the library can never disagree about which
 * images are animatable or which link shape the video studio expects.
 *
 * Pure — no React, no Supabase — so it stays runnable as a self-check
 * (`npx tsx lib/animate-handoff.ts`), mirroring lib/admin-monitoring-flags.ts.
 */

/**
 * Deep-link into the Image to video composer with a library image preselected.
 * `startImageCreationId` is a `user_creations` id, which is what
 * POST /api/generate-video resolves owner-scoped via resolveMentionCreations.
 */
export function animateVideoHref(creationId: string): string {
  return `/tools/video?type=image2video&startImageCreationId=${encodeURIComponent(creationId)}`;
}

type AnimatableCreation = Pick<CreationHistoryItem, "mediaType" | "tool" | "metadata">;

/**
 * Whether a library creation can be sent to Image to video.
 *
 * The exclusions are the point:
 *   - videos are already the output of this flow
 *   - character turnarounds are multi-pose grids, not a single source frame
 *     (PhotoLibraryPicker filters them out too, so they'd land on an empty picker)
 *   - storyboard sheets belong to Storyboard to video, which has its own CTA
 *   - trashed items are pending purge, so their storage object may be gone
 */
export function canAnimateCreation(item: AnimatableCreation): boolean {
  if (item.mediaType !== "image") return false;
  if (item.tool === "storyboard") return false;
  if (item.metadata?.creationKind === "character") return false;
  const deletedAt = item.metadata?.deletedAt;
  if (typeof deletedAt === "string" && deletedAt.trim().length > 0) return false;
  return true;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function base(patch: Partial<AnimatableCreation> = {}): AnimatableCreation {
  return {
    mediaType: "image",
    tool: "product_photo",
    metadata: {},
    ...patch,
  };
}

/** ponytail: runnable without a DB — fails if the animate gating drifts. */
export function animateHandoffSelfCheck(): void {
  assert(canAnimateCreation(base()), "a plain generated photo must be animatable");
  assert(
    canAnimateCreation(base({ metadata: { creationKind: "social_post" } })),
    "a social post image must be animatable"
  );

  assert(
    !canAnimateCreation(base({ mediaType: "video", tool: "video_image2video" })),
    "a video is already the output of this flow"
  );
  assert(
    !canAnimateCreation(base({ metadata: { creationKind: "character" } })),
    "a character turnaround sheet is not a single source frame"
  );
  assert(
    !canAnimateCreation(base({ tool: "storyboard" })),
    "a storyboard sheet belongs to Storyboard to video"
  );
  assert(
    !canAnimateCreation(base({ metadata: { deletedAt: "2026-08-13T00:00:00.000Z" } })),
    "a trashed creation must not be animatable"
  );
  assert(
    canAnimateCreation(base({ metadata: { deletedAt: "" } })),
    "an empty deletedAt is not a trashed item"
  );

  assert(
    animateVideoHref("abc 1/2") ===
      "/tools/video?type=image2video&startImageCreationId=abc%201%2F2",
    "creation id must be url-encoded"
  );

  // The link lands on a PhotoLibraryPicker that lists tool="product_photo" only,
  // so an animatable creation from any other tool would deep-link into a picker
  // that can never preselect it. Adding an image tool must fail here rather than
  // dead-end the CTA at runtime: either the new tool joins that picker, or
  // canAnimateCreation excludes it.
  const animatable = (Object.keys(CREATION_TOOLS) as CreationTool[]).filter(
    (tool) => CREATION_TOOLS[tool].mediaType === "image" && canAnimateCreation(base({ tool }))
  );
  assert(
    animatable.length === 1 && animatable[0] === "product_photo",
    `only product_photo images may be animatable, got: ${animatable.join(", ") || "none"}`
  );
}

if (require.main === module) {
  animateHandoffSelfCheck();
  console.log("animateHandoffSelfCheck: ok");
}
