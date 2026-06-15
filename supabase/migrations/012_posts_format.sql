-- 012_posts_format.sql
-- Persist the publish FORMAT of each scheduled post: Short vs regular Video.
--
-- Background: the scheduler (youtube-format-modes) lets each card publish as a
-- YouTube Short (vertical, ≤ 3 min, #Shorts) or a regular Video. Until now that
-- choice lived only in client state. This adds a durable column so we have a
-- server-side source of truth for Short/Video tracking + future analytics.
--
-- Allowed application values: 'short' | 'video'. The column is NULLABLE on
-- purpose — pre-existing rows (and any post created without a format) stay valid
-- with NULL meaning "unknown / legacy". Validation of the value is enforced in
-- the API layer (app/api/posts/route.ts), not via a DB CHECK, to keep this
-- migration additive + idempotent and friction-free to re-run via `npm run db:setup`.
--
-- Security model (unchanged from 003): RLS stays enabled deny-by-default with no
-- policies; server routes use the service role and enforce access in app code.

-- ---------------------------------------------------------------------------
-- 1) Additive column. Safe to re-run; never touches existing rows' data.
-- ---------------------------------------------------------------------------
alter table posts add column if not exists format text;

comment on column posts.format is
  'Publish format chosen in the scheduler: ''short'' | ''video''. NULL = unknown/legacy. Value validated in the API layer.';
