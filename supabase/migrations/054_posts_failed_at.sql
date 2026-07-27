-- 054_posts_failed_at.sql
-- Tracks when a post most recently transitioned INTO status = 'failed', so a
-- time-based safety-net cleanup (delete storage for posts abandoned in
-- "failed" for a long time) has something real to query against.
--
-- Neither scheduled_time (the original schedule time, never updated) nor any
-- other existing column records this. Set by app/api/cron/route.ts exactly
-- when it gives up (permanent failure, or MAX_PUBLISH_ATTEMPTS exhausted) and
-- writes status = 'failed'.
--
-- Cleared (set back to null) by app/api/posts/[id]/route.ts's PATCH handler
-- whenever a failed post is re-armed to 'scheduled' (Retry button, or editing
-- a failed post's content) — otherwise a stale failed_at from the original
-- failure could cause the safety-net cleanup to delete storage out from under
-- an actively-retried post.
--
-- Idempotent: `add column if not exists` is a no-op on re-run.

alter table posts add column if not exists failed_at timestamptz;

comment on column posts.failed_at is
  'Timestamp of the most recent transition into status = ''failed''. Null while scheduled/published/canceled, and nulled again whenever a failed post is re-armed for retry. Used by the failed-post storage safety-net cleanup (>7 days) — never used for retry/attempt logic itself.';
