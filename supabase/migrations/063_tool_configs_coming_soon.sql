-- 063_tool_configs_coming_soon.sql
-- Admin-configurable "Coming soon" badge for the sidebar nav (and, later,
-- the dashboard tool grid) — app/(app)/dashboard/Sidebar.tsx.
--
-- Previously this concept only existed as a hardcoded `comingSoon?: boolean`
-- per ToolDef in app/(app)/dashboard/page.tsx (never actually set). Moving it
-- onto tool_configs so it's toggleable from /admin/config-v2 like `enabled`
-- and `visible_in_sidebar`, without a code deploy.
--
-- Purely presentational — never gates access. A tool marked coming_soon is
-- still fully reachable; the badge is just a heads-up that it's still being
-- finished.
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).

alter table tool_configs
  add column if not exists coming_soon boolean not null default false;
