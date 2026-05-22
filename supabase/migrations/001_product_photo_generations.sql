-- Product Photo: one row per successful generation, scoped to users.id
-- Run in Supabase Dashboard → SQL Editor

create table if not exists product_photo_generations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid not null references users (id) on delete cascade,
  image_url text not null,
  storage_path text not null,
  pose_id text not null,
  style_id text not null
);

create index if not exists product_photo_generations_user_created_idx
  on product_photo_generations (user_id, created_at desc);

alter table product_photo_generations enable row level security;

-- App uses NextAuth + service role on API routes (not Supabase Auth).
-- No client-side table access; service role bypasses RLS for insert/select.
