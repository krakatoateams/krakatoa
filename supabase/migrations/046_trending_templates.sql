-- 046_trending_templates.sql
-- Trending Templates showcase carousel (dashboard).
-- Global, admin-curated showcase content (NOT owned per-profile). Server routes
-- read via the Supabase service role; RLS stays deny-by-default.
--
-- Each row is a short motion/driving video shown in the dashboard carousel. The
-- "Use Template" action deep-links into Motion Control with the video preloaded
-- as the driving clip.
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).

create extension if not exists pgcrypto;

-- Re-declare the shared updated_at trigger helper (idempotent; matches 003/004/043).
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

create table if not exists trending_templates (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  video_url text not null,
  thumbnail_url text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists trending_templates_active_idx
  on trending_templates (is_active, sort_order);

drop trigger if exists trending_templates_set_updated_at on trending_templates;
create trigger trending_templates_set_updated_at
  before update on trending_templates
  for each row execute function public.krakatoa_set_updated_at();

-- RLS — deny-by-default. Server routes use the service role (bypasses RLS).
-- No anon/authenticated policies.
alter table trending_templates enable row level security;
