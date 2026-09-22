-- 102_tool_preview_access_platform_scope.sql
-- Adds an optional platform scope to the existing tool_preview_access
-- allowlist (076_tool_preview_access.sql), so an email can be granted a
-- bypass for ONE specific platform's coming-soon gate (see
-- supabase/migrations/101_platform_availability.sql) instead of the
-- table's original "bypasses ANY coming_soon gate" grant.
--
-- platform IS NULL (the existing/default meaning): global bypass, unchanged
-- behavior for every row inserted before this migration.
-- platform = 'tiktok' | 'instagram' | 'youtube': scoped bypass for that one
-- platform only — does NOT also grant the Scheduler tool's own coming_soon
-- bypass, and does not bypass a different platform's gate.
--
-- Built for: a real, narrow need — a Google OAuth verification reviewer's
-- test account needs YouTube specifically, without also previewing
-- Instagram or any other coming-soon surface.
--
-- Idempotent: `add column if not exists`.

alter table tool_preview_access
  add column if not exists platform text check (platform in ('tiktok', 'instagram', 'youtube'));

comment on column tool_preview_access.platform is
  'NULL = global bypass (any coming_soon gate, the original behavior). Otherwise scopes this row to bypassing only that one platform''s availability gate (see lib/platform-availability-pure.ts).';
