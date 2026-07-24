-- 047_trending_templates_title_optional.sql
-- Trending templates no longer show a title — users just click "Use template".
-- Make title optional (kept as a nullable column for possible future/admin use).
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).

alter table trending_templates alter column title drop not null;
