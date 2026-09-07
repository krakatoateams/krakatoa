import { canAnimateCreation } from "./animate-handoff";
import type { CreationHistoryItem } from "./creations";

/**
 * Library → Editor hand-off. Same image exclusions as Animate (character
 * sheets, storyboards, trash); any non-trashed video can land on the sequence
 * or as a PiP overlay.
 *
 * Pure — runnable as `npx tsx lib/editor-handoff.ts`.
 */

export function editorCreationHref(creationId: string): string {
  return `/tools/editor?creationId=${encodeURIComponent(creationId)}`;
}

type DroppableCreation = Pick<CreationHistoryItem, "mediaType" | "tool" | "metadata">;

export function canDropOnEditor(item: DroppableCreation): boolean {
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

export function editorHandoffSelfCheck(): void {
  assert(canDropOnEditor(base()), "a plain generated photo must drop onto editor");
  assert(
    canDropOnEditor(base({ mediaType: "video", tool: "video_image2video" })),
    "a generated video must drop onto editor"
  );
  assert(
    canDropOnEditor(base({ mediaType: "video", tool: "video_editor" })),
    "an editor export must be reusable as a clip"
  );
  assert(
    !canDropOnEditor(base({ metadata: { creationKind: "character" } })),
    "a character turnaround sheet is not a single source frame"
  );
  assert(
    !canDropOnEditor(base({ tool: "storyboard" })),
    "a storyboard sheet belongs to Storyboard to video"
  );
  assert(
    !canDropOnEditor(base({ metadata: { deletedAt: "2026-08-13T00:00:00.000Z" } })),
    "a trashed creation must not drop onto editor"
  );
  assert(
    editorCreationHref("abc 1/2") === "/tools/editor?creationId=abc%201%2F2",
    "creation id must be url-encoded"
  );
}

if (require.main === module) {
  editorHandoffSelfCheck();
  console.log("editorHandoffSelfCheck: ok");
}
