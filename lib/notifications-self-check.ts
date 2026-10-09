import {
  categorizePublishFailure,
  describeNotification,
  type NotificationContext,
  type NotificationRecord,
} from "@/lib/notifications-pure";

/**
 * Pure — no DOM, no network — runnable as `npm run test:notifications`.
 * Expected strings are written out literally (the spec), never rebuilt the
 * way the code builds them.
 */

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

function record(
  kind: NotificationRecord["kind"],
  data: Record<string, unknown>,
  readAt: string | null = null,
): NotificationRecord {
  return { id: "n1", kind, data, readAt, createdAt: "2026-10-09T10:00:00.000Z" };
}

function emptyContext(): NotificationContext {
  return { refundedJobIds: new Set(), posts: new Map() };
}

export function notificationsSelfCheck(): void {
  // ── Canvas invitation ────────────────────────────────────────────────────
  const invite = describeNotification(
    record("canvas_invited", {
      canvas_id: "c-123",
      canvas_title: "Promo Oktober",
      inviter_name: "Budi",
      role: "editor",
    }),
    emptyContext(),
  );
  assert(invite.title === "You were invited to a canvas", `invite title: ${invite.title}`);
  assert(invite.body === "Budi invited you to edit “Promo Oktober”.", `invite body: ${invite.body}`);
  assert(invite.href === "/tools/canvas?canvasId=c-123", `invite href: ${invite.href}`);
  assert(invite.tone === "info", "invite is informational");
  assert(invite.unread, "a notification with no read_at is unread");

  // ── Generation succeeded → the tool page, whose Creations shows the result ──
  const video = describeNotification(
    record("generation_succeeded", { job_id: "j1", tool: "reels_seedance" }, "2026-10-09T11:00:00.000Z"),
    emptyContext(),
  );
  assert(video.title === "Your video is ready", `video title: ${video.title}`);
  assert(video.href === "/tools/video", `video href: ${video.href}`);
  assert(video.tone === "success", "success tone");
  assert(!video.unread, "a notification with read_at is read");

  const photo = describeNotification(
    record("generation_succeeded", { job_id: "j2", tool: "product_photo" }),
    emptyContext(),
  );
  assert(photo.title === "Your photo is ready", `photo title: ${photo.title}`);
  assert(photo.href === "/tools/photo-v2", `photo href: ${photo.href}`);

  const unknown = describeNotification(
    record("generation_succeeded", { job_id: "j3", tool: "something_new" }),
    emptyContext(),
  );
  assert(unknown.title === "Your generation is ready", `unknown title: ${unknown.title}`);
  assert(unknown.href === "/dashboard/assets", `unknown tool falls back to My Library: ${unknown.href}`);

  // ── Generation failed → the tool page to try again ──────────────────────
  const refunded = describeNotification(record("generation_failed", { job_id: "j9", tool: "photo" }), {
    refundedJobIds: new Set(["j9"]),
    posts: new Map(),
  });
  assert(refunded.title === "Your photo couldn't be generated", `failed title: ${refunded.title}`);
  assert(
    refunded.body === "Your credits were returned. You can try again anytime.",
    `refunded body: ${refunded.body}`,
  );
  assert(refunded.href === "/tools/photo-v2", `failed href: ${refunded.href}`);
  assert(refunded.tone === "error", "failure tone");

  // No refund recorded → never claim one.
  const notRefunded = describeNotification(
    record("generation_failed", { job_id: "j9", tool: "photo" }),
    emptyContext(),
  );
  assert(
    notRefunded.body === "Something went wrong. Please try again.",
    `unrefunded body must not mention credits: ${notRefunded.body}`,
  );
  // Raw provider errors in the snapshot never reach the copy.
  const raw = describeNotification(
    record("generation_failed", { job_id: "j8", tool: "editor", error: "Replicate 500: CUDA OOM" }),
    emptyContext(),
  );
  assert(!raw.body.includes("CUDA") && !raw.title.includes("CUDA"), "raw errors are never shown");
  assert(raw.title === "Your video export couldn't be finished", `export failed title: ${raw.title}`);

  // ── Post published → calendar, plus the live post when we know it ───────
  const yt = describeNotification(record("post_published", { post_id: "p1", platform: "youtube", title: "Tutorial #3" }), {
    refundedJobIds: new Set(),
    posts: new Map([["p1", { lastError: null, youtubeVideoId: "abc123", instagramPermalink: null, tiktokShareUrl: null }]]),
  });
  assert(yt.title === "Posted to YouTube", `published title: ${yt.title}`);
  assert(yt.body === "“Tutorial #3” is live.", `published body: ${yt.body}`);
  assert(yt.href === "/tools/scheduler/calendar", `published href: ${yt.href}`);
  assert(yt.externalHref === "https://youtu.be/abc123", `youtube link: ${yt.externalHref}`);
  assert(yt.tone === "success", "published tone");

  const ig = describeNotification(record("post_published", { post_id: "p2", platform: "instagram" }), {
    refundedJobIds: new Set(),
    posts: new Map([["p2", { lastError: null, youtubeVideoId: null, instagramPermalink: "https://www.instagram.com/p/XYZ/", tiktokShareUrl: null }]]),
  });
  assert(ig.title === "Posted to Instagram", `ig title: ${ig.title}`);
  assert(ig.body === "Your scheduled post is live.", `untitled post body: ${ig.body}`);
  assert(ig.externalHref === "https://www.instagram.com/p/XYZ/", `ig link: ${ig.externalHref}`);

  // Post since deleted → no lookup row, still renders without a live link.
  const gone = describeNotification(record("post_published", { post_id: "p3", platform: "tiktok" }), emptyContext());
  assert(gone.title === "Posted to TikTok", `tiktok title: ${gone.title}`);
  assert(gone.externalHref === null, "no live link when the post row is gone");

  // ── Publish failure categories (real last_error texts from app/api/cron) ─
  const connection = [
    "No refresh token stored. The user must reconnect tiktok to obtain a refresh token.",
    "No youtube token for user u1. The user must sign in again to re-authorise.",
    "No Instagram account ID stored for this connection. The user must reconnect Instagram to re-authorize.",
    "invalid_grant: Token has been expired or revoked.",
  ];
  for (const message of connection) {
    assert(categorizePublishFailure(message) === "connection", `connection: ${message}`);
  }
  const rejected = [
    "TikTok rejected this post: file_format_check_failed",
    "Instagram reported ERROR while processing this post.",
    "Instagram reported EXPIRED while processing this post.",
    "Instagram reported an error while processing one of this carousel's photos.",
  ];
  for (const message of rejected) {
    assert(categorizePublishFailure(message) === "rejected", `rejected: ${message}`);
  }
  assert(
    categorizePublishFailure(
      "Instagram hasn't finished processing this post after 10 minutes — giving up.",
    ) === "other",
    "a processing timeout is not a media rejection",
  );
  assert(categorizePublishFailure(null) === "other", "missing error → other");

  // ── Post failed → calendar, copy by category, never the raw error ───────
  const failedPost = (lastError: string | null) =>
    describeNotification(record("post_failed", { post_id: "p9", platform: "tiktok" }), {
      refundedJobIds: new Set(),
      posts: new Map([["p9", { lastError, youtubeVideoId: null, instagramPermalink: null, tiktokShareUrl: null }]]),
    });

  const reconnect = failedPost("No refresh token stored. The user must reconnect tiktok to obtain a refresh token.");
  assert(reconnect.title === "Your TikTok post couldn't be published", `post failed title: ${reconnect.title}`);
  assert(
    reconnect.body === "Reconnect your TikTok in Settings, then reschedule the post.",
    `reconnect body: ${reconnect.body}`,
  );
  assert(reconnect.href === "/tools/scheduler/calendar", `post failed href: ${reconnect.href}`);
  assert(reconnect.tone === "error", "post failed tone");

  const media = failedPost("TikTok rejected this post: file_format_check_failed");
  assert(
    media.body === "TikTok couldn't process this media. Check the file and reschedule.",
    `rejected body: ${media.body}`,
  );
  assert(!media.body.includes("file_format_check_failed"), "raw platform codes are never shown");

  // The error captured when it failed wins over the post's current state, so
  // a later retry (which rewrites or clears last_error) can't change advice.
  const snapshotted = describeNotification(
    record("post_failed", {
      post_id: "p9",
      platform: "tiktok",
      last_error: "No refresh token stored. The user must reconnect tiktok to obtain a refresh token.",
    }),
    {
      refundedJobIds: new Set(),
      posts: new Map([["p9", { lastError: null, youtubeVideoId: null, instagramPermalink: null, tiktokShareUrl: null }]]),
    },
  );
  assert(
    snapshotted.body === "Reconnect your TikTok in Settings, then reschedule the post.",
    `snapshot error must drive the copy: ${snapshotted.body}`,
  );

  const generic = failedPost("socket hang up");
  assert(
    generic.body === "Something went wrong. Open the post in Schedule to try again.",
    `generic body: ${generic.body}`,
  );
}

if (require.main === module) {
  notificationsSelfCheck();
  console.log("notificationsSelfCheck: ok");
}
