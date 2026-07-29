-- 056_platform_tokens_nullable_refresh_token.sql
-- Drops the NOT NULL constraint on platform_tokens.refresh_token.
--
-- Background: platform_tokens predates this migrations folder (see
-- scripts/migrations/001-remap-users-to-supabase-auth.sql for its only prior
-- lineage, an FK-remap script — the original CREATE TABLE isn't tracked
-- anywhere). It was assumed to already allow NULL here, based on
-- app/api/connections/youtube/callback/route.ts writing
-- `refresh_token ?? null` defensively — but that null-write path had never
-- actually been exercised in practice (Google always returns a real
-- refresh_token for this app's flow), so the underlying NOT NULL constraint
-- was never caught until Instagram's connect flow (openspec/changes/
-- connect-instagram), which has no refresh_token concept at all and writes a
-- genuine null every time, hit it for real:
--   "null value in column 'refresh_token' of relation 'platform_tokens'
--    violates not-null constraint"
--
-- Safe/additive: only relaxes a constraint, does not touch existing data.
-- Every current YouTube/TikTok row already has a non-null refresh_token, so
-- no backfill or data migration is needed — this only permits future rows
-- (Instagram) to store NULL there.
--
-- Idempotent: DROP CONSTRAINT/DROP NOT NULL on an already-nullable column is
-- a no-op in Postgres, safe to re-run.

alter table platform_tokens alter column refresh_token drop not null;

comment on column platform_tokens.refresh_token is
  'OAuth refresh token, where the platform has one (YouTube, TikTok). NULL for platforms with no refresh_token concept (Instagram — its long-lived access_token refreshes itself; see lib/instagram.ts).';
