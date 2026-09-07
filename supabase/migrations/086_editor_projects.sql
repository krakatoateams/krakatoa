-- 086_editor_projects.sql
-- Named Editor timelines (sequence clips + overlay layers). Media stays in
-- user_creations / temp refs; this table only stores the edit document JSON.
--
-- Additive, idempotent, non-destructive.
-- RLS deny-by-default; server routes use the service role and enforce profile_id.

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

create table if not exists editor_projects (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  title text not null default 'Untitled edit',
  document jsonb not null default '{"v":1,"aspect":"9:16","sequence":[],"overlays":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint editor_projects_title_len check (char_length(title) <= 80)
);

create index if not exists editor_projects_profile_updated_idx
  on editor_projects (profile_id, updated_at desc);

drop trigger if exists editor_projects_set_updated_at on editor_projects;
create trigger editor_projects_set_updated_at
  before update on editor_projects
  for each row execute function public.krakatoa_set_updated_at();

alter table editor_projects enable row level security;
