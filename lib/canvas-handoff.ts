import { canAnimateCreation } from "./animate-handoff";
import type { CreationHistoryItem } from "./creations";

/**
 * Library → Canvas hand-off. Outputs stay product_photo / video_* in
 * user_creations (do not add a canvas CREATION_TOOLS entry — that breaks
 * animateHandoffSelfCheck until the Photo picker also lists the new tool).
 *
 * Pure — runnable as `npx tsx lib/canvas-handoff.ts`.
 */

/** Deep-link an existing library item onto a new canvas. */
export function canvasCreationHref(creationId: string): string {
  return `/tools/canvas?creationId=${encodeURIComponent(creationId)}`;
}

type DroppableCreation = Pick<CreationHistoryItem, "mediaType" | "tool" | "metadata">;

/**
 * Whether a library item can be dropped onto Canvas as a filled Image or Video
 * node. Same image exclusions as Animate (character sheets, storyboards, trash);
 * any non-trashed video is fine.
 */
export function canDropOnCanvas(item: DroppableCreation): boolean {
  if (item.mediaType === "video") {
    const deletedAt = item.metadata?.deletedAt;
    if (typeof deletedAt === "string" && deletedAt.trim().length > 0) return false;
    return true;
  }
  return canAnimateCreation(item);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function base(patch: Partial<DroppableCreation> = {}): DroppableCreation {
  return {
    mediaType: "image",
    tool: "product_photo",
    metadata: {},
    ...patch,
  };
}

export function canvasHandoffSelfCheck(): void {
  assert(canDropOnCanvas(base()), "a plain generated photo must drop onto canvas");
  assert(
    canDropOnCanvas(base({ mediaType: "video", tool: "video_image2video" })),
    "a generated video must drop onto canvas"
  );
  assert(
    !canDropOnCanvas(base({ metadata: { creationKind: "character" } })),
    "a character turnaround sheet is not a single source frame"
  );
  assert(
    !canDropOnCanvas(base({ tool: "storyboard" })),
    "a storyboard sheet belongs to Storyboard to video"
  );
  assert(
    !canDropOnCanvas(base({ metadata: { deletedAt: "2026-08-13T00:00:00.000Z" } })),
    "a trashed creation must not drop onto canvas"
  );
  assert(
    !canDropOnCanvas(
      base({
        mediaType: "video",
        tool: "video_text2video",
        metadata: { deletedAt: "2026-08-13T00:00:00.000Z" },
      })
    ),
    "a trashed video must not drop onto canvas"
  );
  assert(
    canvasCreationHref("abc 1/2") === "/tools/canvas?creationId=abc%201%2F2",
    "creation id must be url-encoded"
  );
}

if (require.main === module) {
  canvasHandoffSelfCheck();
  console.log("canvasHandoffSelfCheck: ok");
}
