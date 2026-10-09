import type { CreationTool } from "@/lib/creations";

const DAY_MS = 24 * 60 * 60 * 1000;

const TOOL_HREF: Record<CreationTool, string> = {
  product_photo: "/tools/photo-v2",
  reels_seedance: "/tools/video?type=reels-creator",
  reels_veo: "/tools/video?type=reels-creator",
  storyboard: "/tools/photo-v2?type=storyboard",
  storyboard_video: "/tools/video?type=storyboard",
  video_text2video: "/tools/video?type=text2video",
  video_image2video: "/tools/video?type=image2video",
  video_motion_control: "/tools/video?type=motion_control",
  video_editor: "/tools/video",
};

/** Tool page for a finished generation. Adds ?creation= when the library row exists. */
export function generationSucceededHref(
  tool: CreationTool | null,
  creationId: string | null
): string {
  const base = tool ? TOOL_HREF[tool] : "/tools/video";
  if (!creationId) return base;
  const url = new URL(base, "https://krakatoa.local");
  url.searchParams.set("creation", creationId);
  return `${url.pathname}${url.search}`;
}

/** Scheduler calendar opened on one post. */
export function postNotificationHref(postId: string): string {
  return `/tools/scheduler/calendar?post=${encodeURIComponent(postId)}`;
}

/** True when the row is older than the configured retention. Null/0 days never expire. */
export function creationIsExpired(
  mediaType: "image" | "video",
  createdAt: string,
  retention: { photoDays: number | null; videoDays: number | null },
  nowMs: number
): boolean {
  const days = mediaType === "video" ? retention.videoDays : retention.photoDays;
  if (days == null || days <= 0) return false;
  const created = Date.parse(createdAt);
  if (!Number.isFinite(created)) return false;
  return nowMs - created > days * DAY_MS;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

export function notificationLinksSelfCheck(): void {
  assert(
    generationSucceededHref("video_image2video", "abc") ===
      "/tools/video?type=image2video&creation=abc",
    "image-to-video notification keeps the composer and adds the creation"
  );
  assert(
    generationSucceededHref("product_photo", null) === "/tools/photo-v2",
    "a generation with no library row stays on the tool page"
  );
  assert(
    generationSucceededHref("reels_veo", "id 1") ===
      "/tools/video?type=reels-creator&creation=id+1",
    "creation ids are encoded"
  );
  assert(
    postNotificationHref("post/1") === "/tools/scheduler/calendar?post=post%2F1",
    "post notifications open the calendar on that post"
  );
  const now = Date.parse("2026-10-09T00:00:00.000Z");
  assert(
    !creationIsExpired("image", "2026-10-01T00:00:00.000Z", { photoDays: 30, videoDays: 7 }, now),
    "a photo inside the retention window is still openable"
  );
  assert(
    creationIsExpired("video", "2026-09-01T00:00:00.000Z", { photoDays: null, videoDays: 7 }, now),
    "a video past its retention is expired"
  );
  assert(
    !creationIsExpired("image", "2020-01-01T00:00:00.000Z", { photoDays: null, videoDays: 7 }, now),
    "null retention never expires"
  );
}

if (process.argv[1]?.endsWith("notification-links-pure.ts")) {
  notificationLinksSelfCheck();
  console.log("notificationLinksSelfCheck: ok");
}
