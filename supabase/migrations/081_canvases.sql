-- 081_canvases.sql
-- Named Canvas graphs (nodes, wires, viewport). Media stays in user_creations;
-- this table only stores the graph JSON and a title.
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

create table if not exists canvases (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  title text not null default 'Untitled canvas',
  graph jsonb not null default '{"v":1,"nodes":[],"edges":[],"viewport":{"x":0,"y":0,"zoom":1}}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canvases_title_len check (char_length(title) <= 80)
);

create index if not exists canvases_profile_updated_idx
  on canvases (profile_id, updated_at desc);

drop trigger if exists canvases_set_updated_at on canvases;
create trigger canvases_set_updated_at
  before update on canvases
  for each row execute function public.krakatoa_set_updated_at();

alter table canvases enable row level security;
