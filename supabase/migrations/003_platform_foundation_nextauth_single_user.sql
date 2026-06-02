-- 003_platform_foundation_nextauth_single_user.sql
-- Krakatoa platform foundation (single-user, NextAuth-only).
-- Ownership boundary = profile_id. profiles links 1:1 to the existing NextAuth
-- users table via profiles.user_id -> users(id) (verified uuid).
--
-- Additive and non-destructive:
--   * create table if not exists / add column if not exists / create index if not exists
--   * does NOT drop or alter existing tables/columns
--   * idempotent backfills (safe to re-run via `npm run db:setup`)
--
-- Legacy tables (user_creations, product_photo_generations, storyboards, posts)
-- remain fully intact. assets is the long-term source of truth for outputs.

-- gen_random_uuid() lives in pgcrypto on some Postgres setups; ensure available.
create extension if not exists pgcrypto;

-- Project-specific updated_at trigger helper (named to avoid global collisions).
create or replace function krakatoa_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1) profiles  (Krakatoa product identity, linked to NextAuth users)
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique not null references users (id) on delete cascade,
  email text,
  display_name text,
  avatar_url text,
  onboarding_completed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_user_id_idx on profiles (user_id);

drop trigger if exists profiles_set_updated_at on profiles;
create trigger profiles_set_updated_at
  before update on profiles
  for each row execute function krakatoa_set_updated_at();

-- Backfill one profile per existing NextAuth user (idempotent).
insert into profiles (user_id, email)
select u.id, u.email
from users u
where not exists (select 1 from profiles p where p.user_id = u.id);

-- ---------------------------------------------------------------------------
-- 2) projects  (generic container for user work)
-- ---------------------------------------------------------------------------
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  tool text not null,
  title text not null,
  status text not null default 'active' check (status in ('active', 'archived', 'deleted')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  deleted_at timestamptz
);

create index if not exists projects_profile_created_idx
  on projects (profile_id, created_at desc) where deleted_at is null;
create index if not exists projects_profile_tool_idx
  on projects (profile_id, tool, created_at desc) where deleted_at is null;
create index if not exists projects_metadata_gin
  on projects using gin (metadata jsonb_path_ops);

drop trigger if exists projects_set_updated_at on projects;
create trigger projects_set_updated_at
  before update on projects
  for each row execute function krakatoa_set_updated_at();

-- ---------------------------------------------------------------------------
-- 3) jobs  (generic generation job for all tools)
-- ---------------------------------------------------------------------------
create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  project_id uuid references projects (id) on delete set null,
  tool text not null,
  job_type text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error jsonb,
  cost_credits int not null default 0,
  provider text,
  model text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists jobs_profile_created_idx on jobs (profile_id, created_at desc);
create index if not exists jobs_profile_status_idx on jobs (profile_id, status, created_at desc);
create index if not exists jobs_profile_tool_idx on jobs (profile_id, tool, created_at desc);
create index if not exists jobs_project_created_idx on jobs (project_id, created_at desc);
create index if not exists jobs_input_gin on jobs using gin (input jsonb_path_ops);
create index if not exists jobs_output_gin on jobs using gin (output jsonb_path_ops);

drop trigger if exists jobs_set_updated_at on jobs;
create trigger jobs_set_updated_at
  before update on jobs
  for each row execute function krakatoa_set_updated_at();

-- ---------------------------------------------------------------------------
-- 4) job_steps  (queryable pipeline step diary)
-- ---------------------------------------------------------------------------
create table if not exists job_steps (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  step_key text not null,
  step_name text,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  input jsonb not null default '{}'::jsonb,
  output jsonb not null default '{}'::jsonb,
  error jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_steps_job_created_idx on job_steps (job_id, created_at);
create index if not exists job_steps_profile_status_idx on job_steps (profile_id, status, created_at desc);
create index if not exists job_steps_stepkey_status_idx on job_steps (step_key, status);
create index if not exists job_steps_job_stepkey_idx on job_steps (job_id, step_key);

drop trigger if exists job_steps_set_updated_at on job_steps;
create trigger job_steps_set_updated_at
  before update on job_steps
  for each row execute function krakatoa_set_updated_at();

-- ---------------------------------------------------------------------------
-- 5) assets  (long-term source of truth for generated files / storage)
-- ---------------------------------------------------------------------------
create table if not exists assets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  project_id uuid references projects (id) on delete set null,
  job_id uuid references jobs (id) on delete set null,
  tool text not null,
  asset_type text not null
    check (asset_type in ('image', 'video', 'audio', 'subtitle', 'json', 'storyboard', 'document', 'other')),
  role text not null,
  status text not null default 'processing'
    check (status in ('processing', 'ready', 'failed', 'deleted')),
  bucket text not null default 'krakatoa',
  storage_path text,
  public_url text,
  mime_type text,
  file_size_bytes bigint,
  width int,
  height int,
  duration_sec numeric,
  provider text,
  model text,
  cost_credits int not null default 0,
  visibility text not null default 'private'
    check (visibility in ('private', 'unlisted', 'public')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists assets_profile_created_idx
  on assets (profile_id, created_at desc) where deleted_at is null;
create index if not exists assets_profile_status_idx
  on assets (profile_id, status, created_at desc) where deleted_at is null;
create index if not exists assets_profile_tool_idx
  on assets (profile_id, tool, created_at desc) where deleted_at is null;
create index if not exists assets_profile_type_idx
  on assets (profile_id, asset_type, created_at desc) where deleted_at is null;
create index if not exists assets_public_idx
  on assets (visibility, created_at desc) where visibility = 'public' and deleted_at is null;
create index if not exists assets_project_created_idx
  on assets (project_id, created_at desc) where deleted_at is null;
create index if not exists assets_job_created_idx on assets (job_id, created_at desc);
create index if not exists assets_metadata_gin on assets using gin (metadata jsonb_path_ops);

drop trigger if exists assets_set_updated_at on assets;
create trigger assets_set_updated_at
  before update on assets
  for each row execute function krakatoa_set_updated_at();

-- ---------------------------------------------------------------------------
-- 6) asset_relations  (flexible parent/child relationships between assets)
-- ---------------------------------------------------------------------------
create table if not exists asset_relations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  parent_asset_id uuid not null references assets (id) on delete cascade,
  child_asset_id uuid not null references assets (id) on delete cascade,
  relation_type text not null
    check (relation_type in ('derived_from', 'thumbnail_of', 'caption_for', 'audio_for', 'storyboard_for', 'source_for', 'variant_of', 'contains')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists asset_relations_parent_idx on asset_relations (parent_asset_id);
create index if not exists asset_relations_child_idx on asset_relations (child_asset_id);
create index if not exists asset_relations_profile_type_idx on asset_relations (profile_id, relation_type);
create unique index if not exists asset_relations_unique_idx
  on asset_relations (parent_asset_id, child_asset_id, relation_type);

-- ---------------------------------------------------------------------------
-- 7) posts  (evolve existing table — additive only; no scheduled_posts table,
--    no creation_id. Existing scheduling/cron + scheduled_time stay intact.)
-- ---------------------------------------------------------------------------
alter table posts add column if not exists profile_id uuid references profiles (id) on delete cascade;
alter table posts add column if not exists project_id uuid references projects (id) on delete set null;
alter table posts add column if not exists asset_id uuid references assets (id) on delete set null;

create index if not exists posts_profile_sched_idx on posts (profile_id, scheduled_time);
create index if not exists posts_profile_status_sched_idx on posts (profile_id, status, scheduled_time);
create index if not exists posts_asset_idx on posts (asset_id);
create index if not exists posts_project_idx on posts (project_id);

-- Backfill profile_id from the existing posts.user_id (idempotent).
update posts
set profile_id = p.id
from profiles p
where p.user_id = posts.user_id and posts.profile_id is null;

-- ---------------------------------------------------------------------------
-- 8) RLS — deny-by-default on all new tables.
--    Server routes use the Supabase service role (which bypasses RLS) and
--    enforce profile ownership in application code. No anon/authenticated
--    policies are created, so non-service roles receive zero rows.
-- ---------------------------------------------------------------------------
alter table profiles        enable row level security;
alter table projects        enable row level security;
alter table jobs            enable row level security;
alter table job_steps       enable row level security;
alter table assets          enable row level security;
alter table asset_relations enable row level security;
