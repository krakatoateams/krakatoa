-- Unified creation history per authenticated user (all tools)
-- Run in Supabase Dashboard → SQL Editor (after 001 if you ran that)

create table if not exists user_creations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references users (id) on delete cascade,
  tool text not null,
  media_type text not null check (media_type in ('image', 'video')),
  media_url text not null,
  storage_path text not null default '',
  title text not null default '',
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists user_creations_user_created_idx
  on user_creations (user_id, created_at desc);

create index if not exists user_creations_user_tool_idx
  on user_creations (user_id, tool, created_at desc);

alter table user_creations enable row level security;

-- Storyboards: scope gallery to signed-in user (skip if table not created yet)
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'storyboards'
  ) then
    alter table storyboards
      add column if not exists user_id uuid references users (id) on delete set null;

    create index if not exists storyboards_user_created_idx
      on storyboards (user_id, created_at desc);
  end if;
end $$;
