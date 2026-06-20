-- 014_posts_publish_attempts.sql
-- Count publish attempts so the cron can retry transient failures a bounded
-- number of times before marking a post 'failed'. Reset to 0 on success.
--
-- Additive and idempotent; safe to run on an existing posts table.

alter table posts add column if not exists publish_attempts integer not null default 0;

comment on column posts.publish_attempts is
  'Number of publish attempts for the current scheduling cycle; reset to 0 on success. Used to cap transient-failure retries.';
