-- 058_platform_tokens_platform_user_id.sql
-- Stores the connected account's platform-side user/account ID
-- (openspec/changes/connect-instagram, Phase 2).
--
-- Background: Instagram's Content Publishing API scopes its endpoints under
-- the account's own Instagram-scoped user ID — POST /{ig-user-id}/media,
-- POST /{ig-user-id}/media_publish — unlike TikTok/YouTube, whose publish
-- calls are scoped entirely by the access token itself with no separate ID
-- needed in the URL. Instagram's code-for-token exchange
-- (app/api/connections/instagram/callback/route.ts, via
-- lib/instagram.ts's exchangeCodeForToken) already receives this ID as
-- `user_id` in its response, but Phase 1 only used it for a one-time
-- eligibility check and never persisted it — a real gap discovered during
-- Phase 2 investigation, before which the publish flow could not have
-- actually called Instagram's API at all.
--
-- Generic column name (not instagram_user_id): platform_tokens already
-- generically supports any `platform` value via `platform`, so a future
-- platform that also needs its own scoping ID can reuse this column rather
-- than each platform inventing its own.
--
-- Nullable — YouTube and TikTok don't need this (their access tokens alone
-- are sufficient), so existing rows stay valid with NULL.
--
-- Idempotent: `add column if not exists` is a no-op on re-run.

alter table platform_tokens add column if not exists platform_user_id text;

comment on column platform_tokens.platform_user_id is
  'The connected account''s platform-side user/account ID, where the platform''s API requires one in its request URLs (e.g. Instagram''s {ig-user-id} for /media and /media_publish). NULL for platforms that scope entirely by access token (YouTube, TikTok).';
