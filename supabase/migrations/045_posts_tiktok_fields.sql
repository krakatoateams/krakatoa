-- 045_posts_tiktok_fields.sql
-- Persist TikTok-specific publish fields on scheduled posts (tiktok-publish change).
--
-- Background: cron publishes due posts per `posts.platform`. YouTube already has
-- `youtube_video_id` for idempotency. TikTok needs the same, plus two fields that
-- MUST be captured from the user at schedule time (not defaulted by the backend):
-- the TikTok privacy level, and the two content-disclosure toggles TikTok's
-- Content Posting API expects (`brand_organic_toggle` / `brand_content_toggle`).
--
-- Allowed application values:
--   tiktok_publish_id           — TikTok's publish_id once Init Direct Post succeeds.
--   tiktok_privacy_level        — one of TikTok's Creator Info privacy_level_options
--                                 (e.g. 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' |
--                                 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY'). Validated in the
--                                 API layer (app/api/posts/route.ts), not a DB CHECK, to
--                                 stay additive/idempotent per this repo's convention.
--   tiktok_brand_organic_toggle / tiktok_brand_content_toggle — independent booleans
--                                 mirroring TikTok's own two-flag request shape (both can
--                                 be true at once). NULL/false = no disclosure.
--
-- Hard rule enforced in the API layer + lib/tiktok.ts, not the DB: a post MUST NOT
-- have tiktok_brand_content_toggle = true together with tiktok_privacy_level =
-- 'SELF_ONLY' — TikTok requires branded content to be publicly viewable.
--
-- All columns are nullable — only meaningful for platform = 'tiktok' rows; existing
-- (YouTube) rows stay valid with NULL.
--
-- Security model (unchanged from 003): RLS stays enabled deny-by-default with no
-- policies; server routes use the service role and enforce access in app code.

-- ---------------------------------------------------------------------------
-- Additive columns. Safe to re-run; never touches existing rows' data.
-- ---------------------------------------------------------------------------
alter table posts add column if not exists tiktok_publish_id text;
alter table posts add column if not exists tiktok_privacy_level text;
alter table posts add column if not exists tiktok_brand_organic_toggle boolean;
alter table posts add column if not exists tiktok_brand_content_toggle boolean;

comment on column posts.tiktok_publish_id is
  'TikTok publish_id returned by Init Direct Post. Presence marks the post as already published to TikTok (idempotency), mirroring youtube_video_id.';
comment on column posts.tiktok_privacy_level is
  'TikTok privacy_level chosen by the user at schedule time (from Creator Info''s privacy_level_options). NULL for non-TikTok posts. Validated in the API layer.';
comment on column posts.tiktok_brand_organic_toggle is
  'Maps to TikTok''s brand_organic_toggle (creator promoting their own business). NULL/false = not disclosed.';
comment on column posts.tiktok_brand_content_toggle is
  'Maps to TikTok''s brand_content_toggle (paid third-party partnership). NULL/false = not disclosed. MUST NOT be true when tiktok_privacy_level = ''SELF_ONLY'' (enforced in the API layer).';
