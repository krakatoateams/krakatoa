-- 013_posts_publish_safety.sql
-- Make automated scheduled publishing safe and debuggable.
--
-- last_error:          human-readable reason the last publish attempt failed.
--                      Cleared on a successful publish. NULL = no failure recorded.
-- publish_started_at:  claim timestamp set by the cron when it begins uploading a
--                      post. Acts as a lightweight lock so overlapping/retried cron
--                      runs cannot upload the same post twice. A claim older than the
--                      stale window is considered abandoned and may be re-claimed.
--
-- Both are additive and idempotent; safe to run on an existing posts table.

alter table posts add column if not exists last_error text;
alter table posts add column if not exists publish_started_at timestamptz;

comment on column posts.last_error is
  'Reason the most recent publish attempt failed; cleared on success. NULL = none.';
comment on column posts.publish_started_at is
  'Cron claim timestamp used as a publish lock to prevent double-uploads; cleared after the attempt resolves.';
