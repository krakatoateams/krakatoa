-- 007_admin_panel.sql
-- Krakatoa Admin Panel foundation (Phase Admin 1).
--
-- Adds the database-backed source of truth for:
--   * admin_users     — who may access the admin panel (replaces hardcoded emails)
--   * tool_configs     — dashboard/sidebar tool visibility + enable flags
--   * pricing_configs  — credit pricing, mirrors lib/credit-costs.ts constants
--   * model_configs    — provider/model identifiers per tool (NO secrets/API keys)
--
-- Additive and non-destructive:
--   * create table if not exists / create index if not exists
--   * does NOT drop or alter existing tables/columns
--   * idempotent seeds (on conflict do nothing) — safe to re-run via `npm run db:setup`
--
-- IMPORTANT (Phase Admin 1 contract):
--   pricing_configs and model_configs are editable from the admin UI but the
--   generation routes DO NOT read them yet. Generation routes keep using the
--   constants in lib/credit-costs.ts and their hardcoded model IDs. Phase Admin 2
--   will add pricing/model resolvers that read these tables WITH a fallback to the
--   existing constants. Until then these rows are display/config only.
--
-- Security model (unchanged from 003/004): RLS is enabled deny-by-default with
-- NO policies. Server routes use the Supabase service role (which bypasses RLS)
-- and enforce admin authorization in application code (lib/admin-auth.ts).

-- gen_random_uuid() lives in pgcrypto on some Postgres setups; ensure available.
create extension if not exists pgcrypto;

-- Project-specific updated_at trigger helper. Already created by 003/004; re-declared
-- here (idempotent) so this migration is safe to apply on its own. search_path is
-- pinned to '' to satisfy the Supabase security linter.
create or replace function public.krakatoa_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) admin_users — source of truth for admin panel access.
--    The seed emails below are only the initial bootstrap; admins manage this
--    table from the panel afterwards. Never trust client-side admin flags.
-- ---------------------------------------------------------------------------
create table if not exists admin_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  profile_id uuid references profiles (id) on delete set null,
  role text not null default 'admin' check (role in ('owner', 'admin')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  granted_by_profile_id uuid references profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists admin_users_set_updated_at on admin_users;
create trigger admin_users_set_updated_at
  before update on admin_users
  for each row execute function public.krakatoa_set_updated_at();

create index if not exists admin_users_status_idx on admin_users (status);
create index if not exists admin_users_profile_idx on admin_users (profile_id);

-- ---------------------------------------------------------------------------
-- 2) tool_configs — controls dashboard/sidebar tool visibility + enable flags.
-- ---------------------------------------------------------------------------
create table if not exists tool_configs (
  id uuid primary key default gen_random_uuid(),
  tool_key text unique not null,
  display_name text not null,
  enabled boolean not null default true,
  visible_in_sidebar boolean not null default true,
  sort_order int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_by_profile_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists tool_configs_set_updated_at on tool_configs;
create trigger tool_configs_set_updated_at
  before update on tool_configs
  for each row execute function public.krakatoa_set_updated_at();

create index if not exists tool_configs_sort_idx on tool_configs (sort_order);

-- ---------------------------------------------------------------------------
-- 3) pricing_configs — credit pricing config. Mirrors lib/credit-costs.ts.
--    For pricing_type='per_second', credit_amount is the per-second rate.
--    NOT consumed by generation routes in Phase Admin 1 (see header note).
-- ---------------------------------------------------------------------------
create table if not exists pricing_configs (
  id uuid primary key default gen_random_uuid(),
  pricing_key text unique not null,
  display_name text not null,
  pricing_type text not null check (pricing_type in ('fixed', 'per_second', 'per_image')),
  credit_amount int not null check (credit_amount >= 0),
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  updated_by_profile_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists pricing_configs_set_updated_at on pricing_configs;
create trigger pricing_configs_set_updated_at
  before update on pricing_configs
  for each row execute function public.krakatoa_set_updated_at();

create index if not exists pricing_configs_key_idx on pricing_configs (pricing_key);

-- ---------------------------------------------------------------------------
-- 4) model_configs — provider/model identifiers + safe parameters per tool.
--    NEVER store secrets/API keys here. API keys stay in environment variables.
--    NOT consumed by generation routes in Phase Admin 1 (see header note).
-- ---------------------------------------------------------------------------
create table if not exists model_configs (
  id uuid primary key default gen_random_uuid(),
  tool_key text not null,
  config_key text not null,
  provider text not null,
  model text not null,
  enabled boolean not null default true,
  is_default boolean not null default false,
  parameters jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  updated_by_profile_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tool_key, config_key)
);

drop trigger if exists model_configs_set_updated_at on model_configs;
create trigger model_configs_set_updated_at
  before update on model_configs
  for each row execute function public.krakatoa_set_updated_at();

create index if not exists model_configs_tool_idx on model_configs (tool_key);

-- ---------------------------------------------------------------------------
-- 5) Read-perf indexes for the admin usage dashboard. Additive; all `if not
--    exists`. These help global (cross-profile) aggregation queries that the
--    admin monitoring routes run via the service role.
-- ---------------------------------------------------------------------------
create index if not exists jobs_tool_created_idx on jobs (tool, created_at desc);
create index if not exists jobs_status_created_idx on jobs (status, created_at desc);
create index if not exists usage_events_created_idx on usage_events (created_at desc);
create index if not exists usage_events_provider_model_idx on usage_events (provider, model);
create index if not exists credit_transactions_type_created_idx on credit_transactions (type, created_at desc);

-- ---------------------------------------------------------------------------
-- 6) Seeds (idempotent). on conflict do nothing so re-runs never duplicate and
--    never clobber later admin edits.
-- ---------------------------------------------------------------------------

-- 6a) Initial admin bootstrap. 1 owner + 2 admins.
insert into admin_users (email, role, status)
values
  ('krakatoa.teams@gmail.com',     'owner', 'active'),
  ('ryansetiawan.works@gmail.com', 'admin', 'active'),
  ('christyvivien@gmail.com',      'admin', 'active')
on conflict (email) do nothing;

-- Best-effort link of seeded admins to existing profiles (idempotent).
update admin_users
set profile_id = p.id
from profiles p
where p.email = admin_users.email and admin_users.profile_id is null;

-- 6b) Tool configs.
insert into tool_configs (tool_key, display_name, enabled, visible_in_sidebar, sort_order)
values
  ('dashboard', 'Dashboard',      true, true, 0),
  ('reels',     'ReelsGen',       true, true, 1),
  ('photo',     'Product Photo',  true, true, 2),
  ('ig',        'IG Automation',  true, true, 3),
  ('schedule',  'Schedule',       true, true, 4),
  ('calendar',  'Calendar',       true, true, 5)
on conflict (tool_key) do nothing;

-- 6c) Pricing configs — mirror lib/credit-costs.ts current values.
insert into pricing_configs (pricing_key, display_name, pricing_type, credit_amount)
values
  ('initial_dummy_credits',     'Initial Dummy Credits',          'fixed',      500),
  ('product_photo',             'Product Photo',                  'per_image',  5),
  ('storyboard_image',          'Storyboard Image',               'per_image',  2),
  ('storyboard_video',          'Storyboard Video',               'fixed',      30),
  ('seedance_video_per_second', 'Seedance / ReelsGen (per sec)',  'per_second', 2),
  ('veo_video_per_second',      'Veo Video (per sec)',            'per_second', 2)
on conflict (pricing_key) do nothing;

-- 6d) Model configs — mirror current hardcoded provider/model IDs.
--     provider is the delivery provider (Replicate for all AI models here); the
--     google/ , bytedance/ , openai/ prefix is part of the Replicate model id,
--     matching how jobs.provider/model are already written.
insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels',      'llm',       'replicate', 'google/gemini-2.5-flash',        true, '{}'::jsonb),
  ('reels',      'video',     'replicate', 'bytedance/seedance-2.0-fast',    true, '{}'::jsonb),
  ('reels',      'tts',       'replicate', 'minimax/speech-02-turbo',        true, '{}'::jsonb),
  ('reels',      'whisper',   'replicate', 'vaibhavs10/incredibly-fast-whisper', true,
     '{"version":"3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c"}'::jsonb),
  ('veo',        'llm',       'replicate', 'google/gemini-2.5-flash',        true, '{}'::jsonb),
  ('veo',        'video',     'replicate', 'google/veo-3.1-lite',            true, '{}'::jsonb),
  ('veo',        'tts',       'replicate', 'minimax/speech-02-turbo',        true, '{}'::jsonb),
  ('veo',        'whisper',   'replicate', 'vaibhavs10/incredibly-fast-whisper', true,
     '{"version":"3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c"}'::jsonb),
  ('storyboard', 'scene_llm', 'replicate', 'openai/gpt-5',                   true, '{}'::jsonb),
  ('storyboard', 'image',     'replicate', 'openai/gpt-image-2',             true, '{}'::jsonb),
  ('storyboard', 'video',     'replicate', 'bytedance/seedance-2.0-fast',    true, '{}'::jsonb),
  ('photo',      'image',     'replicate', 'google/nano-banana',             true, '{}'::jsonb),
  ('render',     'rendi',     'rendi',     'default',                        true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;

-- ---------------------------------------------------------------------------
-- 7) RLS — deny-by-default on all new tables. Server routes use the service role
--    (which bypasses RLS) and enforce admin authorization in app code. No
--    anon/authenticated policies are created, so non-service roles get zero rows.
-- ---------------------------------------------------------------------------
alter table admin_users     enable row level security;
alter table tool_configs    enable row level security;
alter table pricing_configs enable row level security;
alter table model_configs   enable row level security;
