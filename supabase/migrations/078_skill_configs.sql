-- 078_skill_configs.sql
-- Admin-editable overlays on the code catalog in lib/skills.ts.
-- Title, description, placeholder, recipe (how the skill prompts the model),
-- and an optional Storage thumbnail. Catalog ids / media types stay in code.
--
-- Additive, idempotent, non-destructive.
-- RLS deny-by-default; server routes use the service role and requireAdmin().

create extension if not exists pgcrypto;

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

create table if not exists skill_configs (
  skill_id text primary key,
  title text,
  description text,
  prompt_placeholder text,
  recipe text,
  thumb_path text,
  category text,
  badge text,
  prompt_required boolean,
  updated_by_profile_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists skill_configs_set_updated_at on skill_configs;
create trigger skill_configs_set_updated_at
  before update on skill_configs
  for each row execute function public.krakatoa_set_updated_at();

alter table skill_configs enable row level security;
