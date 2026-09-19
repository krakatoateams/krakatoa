-- 101_platform_availability.sql
-- Platform availability (see CONTEXT.md): a single per-platform flag,
-- product-wide, that governs both connecting the account (Settings) and
-- selecting it in Schedule — Schedule is currently the only feature anywhere
-- in the app that consumes TikTok/Instagram/YouTube connections, so one
-- flag per platform is enough; no per-tool scoping needed.
--
-- Distinct from tool_configs.coming_soon (007_admin_panel.sql), which is
-- purely cosmetic and never blocks anyone. This flag actually blocks a
-- disabled platform for regular users; admins always bypass it (see
-- lib/platform-availability-pure.ts's isPlatformUsable/platformBadge and
-- lib/admin-auth.ts's getCurrentAdmin).
--
-- Idempotent: `create table if not exists` + a guarded seed insert.

create table if not exists platform_availability (
  platform text primary key check (platform in ('tiktok', 'instagram', 'youtube')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

-- Deny-by-default (see AGENTS.md, 093_deny_by_default_legacy_policies.sql):
-- no policies means no row is reachable via PostgREST with an anon/user JWT.
-- All app reads/writes go through lib/platform-availability-db.ts's
-- supabaseServer (service role), which bypasses RLS entirely.
alter table platform_availability enable row level security;

comment on table platform_availability is
  'One row per social platform. enabled=false means the platform is "coming soon": hidden/disabled for regular users (both the Settings connect button and the Schedule compose checkbox), but fully usable for an admin (see getCurrentAdmin bypass).';

-- Seed: TikTok open now, Instagram and YouTube coming soon — matches the
-- initial rollout this migration was written for. Only inserts rows that
-- don't already exist, so re-running this migration never resets an admin's
-- later toggle back to the seed default.
insert into platform_availability (platform, enabled)
values ('tiktok', true), ('instagram', false), ('youtube', false)
on conflict (platform) do nothing;
