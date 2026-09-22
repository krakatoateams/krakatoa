-- 104_posts_instagram_carousel.sql
-- Instagram carousel publishing (previously deferred — see
-- 059_posts_instagram_fields.sql's "single image only" Non-Goal). Grilled
-- decisions: photos-only (no mixed video), same full photo set TikTok
-- already gets (bounded to Instagram's own max — see
-- lib/instagram.ts's INSTAGRAM_CAROUSEL_MAX_ITEMS, currently 10 per Meta's
-- published Content Publishing API docs), per-child progress tracking
-- rather than a fixed-attempt-count retry.
--
-- A carousel needs N child media containers (one per photo, is_carousel_item:
-- true) to each reach FINISHED before a parent CAROUSEL container can be
-- created — this column remembers the child container IDs across cron ticks
-- (this app checks container status once per tick, never in an in-request
-- poll loop — see 059's design.md Decision 4). Once every child is
-- FINISHED, the cron creates the parent container and stores ITS id in the
-- existing posts.instagram_container_id column, unchanged — from that point
-- on, a carousel post is indistinguishable from a single-image post to the
-- rest of the existing poll/publish/give-up code.
--
-- NULL for a non-Instagram post, a single-photo/video Instagram post (no
-- carousel needed), or before the first child-container-creation attempt.
-- Cleared alongside instagram_container_id on ERROR/EXPIRED/give-up, same
-- lifecycle.
--
-- Idempotent: `add column if not exists` is a no-op on re-run.

alter table posts add column if not exists instagram_carousel_child_ids text[];

comment on column posts.instagram_carousel_child_ids is
  'Instagram carousel only: child media container IDs (one per photo, created with is_carousel_item=true), in photo order. Tracked across cron ticks until every child reaches FINISHED, at which point the parent CAROUSEL container is created and its ID takes over posts.instagram_container_id for the existing poll/publish flow. NULL for non-carousel posts.';
