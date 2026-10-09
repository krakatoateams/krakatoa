/**
 * Pure rendering for in-app Notifications (see CONTEXT.md). A stored row only
 * carries a kind + a small data snapshot; everything the user reads — title,
 * body, link — is derived here at read time, so copy fixes apply to old rows
 * and raw provider errors never leave the server.
 *
 * No DOM, no network: covered by lib/notifications-self-check.ts.
 */

export type NotificationKind =
  | "generation_succeeded"
  | "generation_failed"
  | "post_published"
  | "post_failed"
  | "canvas_invited";

export type NotificationRecord = {
  id: string;
  kind: NotificationKind;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

/** The current state of a post a Notification points at. */
export type NotificationPostFacts = {
  lastError: string | null;
  youtubeVideoId: string | null;
  instagramPermalink: string | null;
  tiktokShareUrl: string | null;
};

/** Read-time facts looked up for the rows being rendered. */
export type NotificationContext = {
  refundedJobIds: Set<string>;
  posts: Map<string, NotificationPostFacts>;
};

export type NotificationTone = "success" | "error" | "info";

export type NotificationView = {
  id: string;
  kind: NotificationKind;
  tone: NotificationTone;
  title: string;
  body: string;
  href: string;
  externalHref: string | null;
  unread: boolean;
  createdAt: string;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** `failed` completes "Your <noun> couldn't be …". */
type ToolInfo = { noun: string; failed: string; href: string };

const PHOTO: ToolInfo = { noun: "photo", failed: "generated", href: "/tools/photo-v2" };
const VIDEO: ToolInfo = { noun: "video", failed: "generated", href: "/tools/video" };

/** jobs.tool → what the user calls the result, and the page showing it. */
const TOOLS: Record<string, ToolInfo> = {
  photo: PHOTO,
  product_photo: PHOTO,
  storyboard: VIDEO,
  storyboard_video: VIDEO,
  reels: VIDEO,
  reels_seedance: VIDEO,
  video_motion_control: VIDEO,
  canvas: { noun: "canvas generation", failed: "finished", href: "/tools/canvas" },
  editor: { noun: "video export", failed: "finished", href: "/tools/editor" },
  video_editor: { noun: "video export", failed: "finished", href: "/tools/editor" },
};

const UNKNOWN_TOOL: ToolInfo = { noun: "generation", failed: "finished", href: "/dashboard/assets" };

function toolInfo(tool: unknown): ToolInfo {
  const key = text(tool);
  return (key && TOOLS[key]) || UNKNOWN_TOOL;
}

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  instagram: "Instagram",
  youtube: "YouTube",
};

function platformLabel(platform: unknown): string {
  const key = text(platform);
  return (key && PLATFORM_LABELS[key]) || "your account";
}

function httpsUrl(value: string | null): string | null {
  return value && /^https:\/\//i.test(value) ? value : null;
}

/** Link to the post on the platform itself, when we know it. */
function livePostUrl(post: NotificationPostFacts | undefined): string | null {
  if (!post) return null;
  if (post.youtubeVideoId && /^[A-Za-z0-9_-]+$/.test(post.youtubeVideoId)) {
    return `https://youtu.be/${post.youtubeVideoId}`;
  }
  return httpsUrl(post.instagramPermalink) ?? httpsUrl(post.tiktokShareUrl);
}

export type PublishFailureCategory = "connection" | "rejected" | "other";

const CONNECTION_FAILURE =
  /\b(no (refresh )?token|no [a-z]+ token|reconnect|re-?authori[sz]e|invalid_grant|token has been expired|revoked)\b/i;
const REJECTED_FAILURE = /(rejected this post|reported (error|expired) while processing|error while processing)/i;

/**
 * Bucket a post's stored last_error so the copy can suggest the one action
 * that helps. Only the bucket is ever shown — never the text itself.
 */
export function categorizePublishFailure(lastError: string | null): PublishFailureCategory {
  if (!lastError) return "other";
  if (CONNECTION_FAILURE.test(lastError)) return "connection";
  if (REJECTED_FAILURE.test(lastError)) return "rejected";
  return "other";
}

export function describeNotification(
  record: NotificationRecord,
  context: NotificationContext,
): NotificationView {
  const base = {
    id: record.id,
    kind: record.kind,
    unread: record.readAt === null,
    createdAt: record.createdAt,
    externalHref: null as string | null,
  };
  const { data } = record;

  if (record.kind === "generation_succeeded") {
    const tool = toolInfo(data.tool);
    return {
      ...base,
      tone: "success",
      title: `Your ${tool.noun} is ready`,
      body: "Open it from your recent creations.",
      href: tool.href,
    };
  }

  if (record.kind === "generation_failed") {
    const tool = toolInfo(data.tool);
    const jobId = text(data.job_id);
    // Only a refund actually recorded in credit_transactions earns this line.
    const refunded = jobId !== null && context.refundedJobIds.has(jobId);
    return {
      ...base,
      tone: "error",
      title: `Your ${tool.noun} couldn't be ${tool.failed}`,
      body: refunded
        ? "Your credits were returned. You can try again anytime."
        : "Something went wrong. Please try again.",
      href: tool.href,
    };
  }

  if (record.kind === "post_published") {
    const postId = text(data.post_id);
    const postTitle = text(data.title);
    return {
      ...base,
      tone: "success",
      title: `Posted to ${platformLabel(data.platform)}`,
      body: postTitle ? `“${postTitle}” is live.` : "Your scheduled post is live.",
      href: "/tools/scheduler/calendar",
      externalHref: livePostUrl(postId ? context.posts.get(postId) : undefined),
    };
  }

  if (record.kind === "post_failed") {
    const postId = text(data.post_id);
    const platform = platformLabel(data.platform);
    // Prefer the error captured at failure time, so a later retry can't
    // rewrite the advice; fall back to the post's current state.
    const category = categorizePublishFailure(
      text(data.last_error) ?? ((postId && context.posts.get(postId)?.lastError) || null),
    );
    const body =
      category === "connection"
        ? `Reconnect your ${platform} in Settings, then reschedule the post.`
        : category === "rejected"
          ? `${platform} couldn't process this media. Check the file and reschedule.`
          : "Something went wrong. Open the post in Schedule to try again.";
    return {
      ...base,
      tone: "error",
      title: `Your ${platform} post couldn't be published`,
      body,
      href: "/tools/scheduler/calendar",
    };
  }

  const canvasId = text(data.canvas_id);
  const title = text(data.canvas_title) ?? "Untitled canvas";
  const inviter = text(data.inviter_name) ?? "Someone";
  const verb = data.role === "viewer" ? "view" : "edit";
  return {
    ...base,
    tone: "info",
    title: "You were invited to a canvas",
    body: `${inviter} invited you to ${verb} “${title}”.`,
    href: canvasId ? `/tools/canvas?canvasId=${encodeURIComponent(canvasId)}` : "/tools/canvas",
  };
}
