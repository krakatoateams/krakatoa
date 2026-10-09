import { supabaseServer } from "@/lib/supabase-server";
import type { Profile } from "@/lib/profiles-db";
import {
  describeNotification,
  type NotificationContext,
  type NotificationPostFacts,
  type NotificationRecord,
  type NotificationView,
} from "@/lib/notifications-pure";

/**
 * Server-side access to in-app Notifications. Rows are only ever written by
 * the database triggers in migration 110 (see
 * docs/adr/0001-notifications-via-db-triggers.md); this module reads them,
 * marks them read and prunes old ones. Service role — every query is scoped
 * to the caller's profile here in code.
 */

const TABLE = "notifications";

/** How many of the newest Notifications the bell panel shows. */
export const NOTIFICATION_LIST_LIMIT = 30;

/** Notifications older than this are deleted by the retention cron. */
export const NOTIFICATION_RETENTION_DAYS = 30;

type NotificationRow = {
  id: string;
  kind: NotificationRecord["kind"];
  data: Record<string, unknown> | null;
  read_at: string | null;
  created_at: string;
};

type PostFactsRow = {
  id: string;
  last_error: string | null;
  youtube_video_id: string | null;
  instagram_permalink: string | null;
  tiktok_share_url: string | null;
};

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  throw new Error(error.message || fallback);
}

function idsFrom(rows: NotificationRow[], kinds: NotificationRecord["kind"][], key: string): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (!kinds.includes(row.kind)) continue;
    const value = row.data?.[key];
    if (typeof value === "string" && value) ids.add(value);
  }
  return [...ids];
}

/** Jobs among `jobIds` that have a recorded, succeeded refund. */
async function refundedJobIds(profileId: string, jobIds: string[]): Promise<Set<string>> {
  if (jobIds.length === 0) return new Set();
  const { data, error } = await supabaseServer
    .from("credit_transactions")
    .select("job_id")
    .eq("profile_id", profileId)
    .eq("type", "refund")
    .eq("status", "succeeded")
    .in("job_id", jobIds);
  handleError(error, "Failed to read refunds.");
  return new Set(
    ((data ?? []) as { job_id: string | null }[])
      .map((row) => row.job_id)
      .filter((id): id is string => !!id),
  );
}

/** Current state of the caller's own posts among `postIds`. */
async function postFacts(
  profile: Profile,
  postIds: string[],
): Promise<Map<string, NotificationPostFacts>> {
  if (postIds.length === 0) return new Map();
  const { data, error } = await supabaseServer
    .from("posts")
    .select("id, last_error, youtube_video_id, instagram_permalink, tiktok_share_url")
    .in("id", postIds)
    .or(`profile_id.eq.${profile.id},user_id.eq.${profile.user_id}`);
  handleError(error, "Failed to read posts.");
  return new Map(
    ((data ?? []) as PostFactsRow[]).map((row) => [
      row.id,
      {
        lastError: row.last_error,
        youtubeVideoId: row.youtube_video_id,
        instagramPermalink: row.instagram_permalink,
        tiktokShareUrl: row.tiktok_share_url,
      },
    ]),
  );
}

/** The caller's newest Notifications, rendered for display. */
export async function listNotificationViews(profile: Profile): Promise<NotificationView[]> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("id, kind, data, read_at, created_at")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(NOTIFICATION_LIST_LIMIT);
  handleError(error, "Failed to list notifications.");
  const rows = (data ?? []) as NotificationRow[];

  const [refunds, posts] = await Promise.all([
    refundedJobIds(profile.id, idsFrom(rows, ["generation_failed"], "job_id")),
    postFacts(profile, idsFrom(rows, ["post_published", "post_failed"], "post_id")),
  ]);
  const context: NotificationContext = { refundedJobIds: refunds, posts };

  return rows.map((row) =>
    describeNotification(
      {
        id: row.id,
        kind: row.kind,
        data: row.data ?? {},
        readAt: row.read_at,
        createdAt: row.created_at,
      },
      context,
    ),
  );
}

export async function countUnreadNotifications(profileId: string): Promise<number> {
  const { count, error } = await supabaseServer
    .from(TABLE)
    .select("id", { head: true, count: "exact" })
    .eq("profile_id", profileId)
    .is("read_at", null);
  handleError(error, "Failed to count notifications.");
  return count ?? 0;
}

/**
 * Mark the caller's unread Notifications read, up to and including the newest
 * one the panel showed — so a row created after the panel loaded stays unread.
 * Older rows beyond the list limit are included on purpose: the panel can
 * never show them, and leaving them unread would pin the badge.
 */
export async function markNotificationsReadThrough(
  profileId: string,
  newestShownIso: string,
): Promise<void> {
  const { error } = await supabaseServer
    .from(TABLE)
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", profileId)
    .is("read_at", null)
    .lte("created_at", newestShownIso);
  handleError(error, "Failed to mark notifications read.");
}

/** Delete Notifications created before `cutoffIso`; returns how many. */
export async function pruneNotificationsBefore(cutoffIso: string): Promise<number> {
  const { count, error } = await supabaseServer
    .from(TABLE)
    .delete({ count: "exact" })
    .lt("created_at", cutoffIso);
  handleError(error, "Failed to prune notifications.");
  return count ?? 0;
}
