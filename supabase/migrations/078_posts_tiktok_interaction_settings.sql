-- 078_posts_tiktok_interaction_settings.sql
-- TikTok interaction toggles (Allow Comment/Duet/Stitch) + daily-cap
-- auto-retry bookkeeping, closing gaps flagged by TikTok's Content Sharing
-- Guidelines review (see docs/... if a write-up is added later).
--
-- Background: TikTok's Direct Post Init endpoint accepts disable_comment /
-- disable_duet / disable_stitch on post_info. Per TikTok's own UX guideline,
-- these must default to "disabled" (none checked by default) and are
-- meaningless for photo posts (Duet/Stitch aren't a photo-post concept at
-- all — always true there, enforced independently in the API layer and in
-- lib/tiktok.ts, not just here).
--
-- Existing TikTok rows predate this feature and would read back tiktok_
-- disable_comment/duet/stitch as NULL. Rather than relying on TikTok's API
-- treating an omitted field the same as an explicit `false` (today's actual
-- request never includes these keys at all), this migration backfills
-- existing rows to explicit `false` so old and new rows behave identically
-- by construction.
--
-- tiktok_rate_limited_first_attempted_at / tiktok_rate_limit_retry_after
-- support a 24h wall-clock auto-retry for TikTok's spam_risk_too_many_posts
-- (daily post cap) response, mirroring posts.instagram_first_attempted_at's
-- existing pattern. The retry_after column exists specifically so a
-- rate-limited post doesn't win the cron's single-post-per-tick slot
-- (MAX_POSTS_PER_RUN = 1, app/api/cron/route.ts) on every tick for up to a
-- full day, starving every other user's due post.
--
-- All columns nullable/additive; only meaningful for platform = 'tiktok'
-- rows. Security model unchanged from 003 (RLS deny-by-default, service
-- role + app-code ownership checks).

alter table posts add column if not exists tiktok_disable_comment boolean;
alter table posts add column if not exists tiktok_disable_duet boolean;
alter table posts add column if not exists tiktok_disable_stitch boolean;
alter table posts add column if not exists tiktok_rate_limited_first_attempted_at timestamptz;
alter table posts add column if not exists tiktok_rate_limit_retry_after timestamptz;

comment on column posts.tiktok_disable_comment is
  'Maps to TikTok''s disable_comment (post_info). Chosen by the user at schedule time via an "Allow Comment" checkbox that defaults unchecked (disable_comment = true). NULL for non-TikTok posts.';
comment on column posts.tiktok_disable_duet is
  'Maps to TikTok''s disable_duet (post_info). Always true for photo posts (Duet is not a photo-post concept) — enforced independently in the API layer and in lib/tiktok.ts''s initPhotoPost, not only by this default. NULL for non-TikTok posts.';
comment on column posts.tiktok_disable_stitch is
  'Maps to TikTok''s disable_stitch (post_info). Always true for photo posts (Stitch is not a photo-post concept) — enforced independently in the API layer and in lib/tiktok.ts''s initPhotoPost, not only by this default. NULL for non-TikTok posts.';
comment on column posts.tiktok_rate_limited_first_attempted_at is
  'Set on the first spam_risk_too_many_posts response from TikTok''s creator_info for this post; cleared on success or once the 24h give-up budget (app/api/cron/route.ts) is exhausted. NULL for posts never rate-limited.';
comment on column posts.tiktok_rate_limit_retry_after is
  'Backoff: the cron will not re-check this post before this time while it is being auto-retried for a TikTok daily-cap hit. Prevents a single rate-limited post from occupying the cron''s MAX_POSTS_PER_RUN = 1 slot on every tick. NULL for posts not currently backed off.';

-- Backfill: existing TikTok rows predate these columns. Match today's actual
-- (pre-migration) behavior explicitly rather than relying on an unverified
-- assumption about how TikTok's API treats an omitted vs. explicit-false field.
update posts
set tiktok_disable_comment = false,
    tiktok_disable_duet = false,
    tiktok_disable_stitch = false
where platform = 'tiktok'
  and tiktok_disable_comment is null;
