// Derived display status for scheduled posts.
//
// The stored `status` column only knows draft/scheduled/published/failed. The UI
// wants two extra *derived* states so a past-due post doesn't look stuck or get
// mistaken for a failure:
//   - "publishing": the cron has claimed it (publish_started_at is recent) and is
//                   uploading right now.
//   - "overdue":    its scheduled time has passed but the cron hasn't claimed it
//                   yet (the next tick will pick it up).
//
// These are display-only and never change the stored status.

export type PostDisplayStatus =
  | "draft"
  | "scheduled"
  | "overdue"
  | "publishing"
  | "published"
  | "failed";

export interface PostStatusInput {
  status: "draft" | "scheduled" | "published" | "failed";
  scheduled_time: string;
  publish_started_at?: string | null;
}

// A claim older than this is treated as abandoned, so the post reads as "overdue"
// (awaiting retry) rather than a stuck "publishing". Mirrors the cron's stale window.
const CLAIM_STALE_MS = 10 * 60 * 1000;

export function derivePostDisplayStatus(
  post: PostStatusInput,
  now: number = Date.now(),
): PostDisplayStatus {
  if (post.status === "published") return "published";
  if (post.status === "failed") return "failed";
  if (post.status === "draft") return "draft";

  // status === "scheduled" from here on.
  if (post.publish_started_at) {
    const claimedAt = new Date(post.publish_started_at).getTime();
    if (Number.isFinite(claimedAt) && now - claimedAt < CLAIM_STALE_MS) {
      return "publishing";
    }
  }

  const dueAt = new Date(post.scheduled_time).getTime();
  if (Number.isFinite(dueAt) && dueAt <= now) return "overdue";

  return "scheduled";
}
