-- 100_platform_tokens_username.sql
-- Stores the connected account's display identity (TikTok creator nickname,
-- Instagram @username) so the Scheduler's "Connected accounts" row can show
-- WHO you're posting as, not just that a platform is connected. Generic
-- single column across all three platforms, mirroring how
-- platform_tokens.platform_user_id (058) already works this way for
-- Instagram — though YouTube never populates it (see below).
--
-- Populated in each platform's OAuth callback route:
--   - TikTok: getCreatorInfo(...).creatorNickname, captured at connect time
--     (already fetched there for a best-effort validation step — previously
--     discarded, now also stored) and refreshed on every later creator-info
--     call the Scheduler already makes
--   - Instagram: lib/instagram.ts's getAccountUsername, at connect time
--   - YouTube: intentionally NOT populated. Reading the channel title
--     (channels.list) needs at least the youtube.readonly scope, and this
--     app only ever requests youtube.upload — broadening that would mean
--     every user re-consenting and possibly a Google OAuth re-verification,
--     decided against. The YouTube badge just shows "Connected" with no name.
-- TikTok/Instagram are best-effort: a failure to fetch the display name must
-- never block or fail the connect flow itself, so this can legitimately stay
-- NULL for an otherwise-successful connection (an older connection made
-- before this migration will also read as NULL until reconnected).
--
-- Idempotent: `add column if not exists` is a no-op on re-run.

alter table platform_tokens add column if not exists username text;

comment on column platform_tokens.username is
  'Connected account display identity — TikTok creator nickname or Instagram @username. Always NULL for YouTube (channel title would need a broader OAuth scope than this app requests). Fetched best-effort at connect time for TikTok/Instagram; NULL for a pre-existing connection until reconnected, or if the fetch itself failed.';
