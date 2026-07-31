-- 059_posts_instagram_fields.sql
-- Persist Instagram-specific publish/idempotency fields on scheduled posts
-- (openspec/changes/connect-instagram, Phase 2).
--
-- instagram_container_id — the container returned by POST /{ig-user-id}/media,
--   before it's actually published. Persisted immediately on creation (before
--   the first status poll) so a mid-poll timeout or crash resumes on the next
--   cron tick instead of creating a duplicate container — mirrors
--   tiktok_publish_id's role. Nulled out again on a confirmed ERROR/EXPIRED
--   status or the 10-minute give-up timeout, since neither container can ever
--   recover — a retry must create a fresh one, not re-poll a dead ID.
--
-- instagram_media_id — the final media ID returned by POST
--   /{ig-user-id}/media_publish, once the container reaches FINISHED and is
--   actually published. Presence marks the post as done (idempotency),
--   mirroring youtube_video_id / tiktok_publish_id's own "already published"
--   short-circuit.
--
-- instagram_first_attempted_at — wall-clock timestamp of the first attempt to
--   publish this post to Instagram (set once, when instagram_container_id is
--   first created). Instagram's IN_PROGRESS outcome is not a failure and
--   doesn't increment publish_attempts, so give-up logic can't reuse
--   MAX_PUBLISH_ATTEMPTS (an attempt-count, not a wall-clock budget) —
--   app/api/cron/route.ts instead gives up once 10 minutes have elapsed since
--   this timestamp (see openspec/changes/connect-instagram/design.md Decision
--   6, confirmed by the user). Cleared alongside instagram_container_id on
--   ERROR/EXPIRED/give-up, so a subsequent retry gets a clean 10-minute
--   budget rather than immediately re-timing-out against a stale value.
--
-- All columns nullable — only meaningful for platform = 'instagram' rows;
-- existing (YouTube/TikTok) rows stay valid with NULL.
--
-- Idempotent: `add column if not exists` is a no-op on re-run.

alter table posts add column if not exists instagram_container_id text;
alter table posts add column if not exists instagram_media_id text;
alter table posts add column if not exists instagram_first_attempted_at timestamptz;

comment on column posts.instagram_container_id is
  'Instagram container_id from POST /{ig-user-id}/media, before publish. Cleared on a confirmed ERROR/EXPIRED status or the 10-minute give-up timeout so a retry creates a fresh container. NULL for non-Instagram posts.';
comment on column posts.instagram_media_id is
  'Instagram media_id from POST /{ig-user-id}/media_publish. Presence marks the post as already published to Instagram (idempotency), mirroring youtube_video_id / tiktok_publish_id. NULL for non-Instagram posts.';
comment on column posts.instagram_first_attempted_at is
  'Timestamp of the first attempt to publish this post to Instagram. Used for a wall-clock (not attempt-count) 10-minute give-up on a container stuck IN_PROGRESS. Cleared alongside instagram_container_id on ERROR/EXPIRED/give-up. NULL for non-Instagram posts.';
