-- 048_expiry_settings.sql
-- Expiry Management (admin) — global expiry durations for credits + creations.
--
-- Singleton config table (key='global') mirroring billing_settings (009). Each
-- column is a duration in DAYS; NULL means "never expires". The admin Expiry
-- panel reads/writes this row; the enforcement crons read it to decide what to
-- expire/delete.
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).
-- Security model (unchanged from 003/004/007/009): RLS enabled deny-by-default
-- with NO policies. Server routes use the Supabase service role (bypasses RLS)
-- and enforce admin access in application code.

create extension if not exists pgcrypto;

-- Shared updated_at trigger helper (re-declared idempotently).
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
-- expiry_settings — singleton table of expiry durations (days; NULL = never).
--   The `check (key = 'global')` guard makes this a single-row table.
-- ---------------------------------------------------------------------------
create table if not exists expiry_settings (
  key text primary key default 'global' check (key = 'global'),
  regular_credit_days int check (regular_credit_days is null or regular_credit_days >= 0),
  purchase_bonus_credit_days int check (purchase_bonus_credit_days is null or purchase_bonus_credit_days >= 0),
  new_user_bonus_credit_days int check (new_user_bonus_credit_days is null or new_user_bonus_credit_days >= 0),
  photo_creation_days int check (photo_creation_days is null or photo_creation_days >= 0),
  video_creation_days int check (video_creation_days is null or video_creation_days >= 0),
  updated_by_profile_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists expiry_settings_set_updated_at on expiry_settings;
create trigger expiry_settings_set_updated_at
  before update on expiry_settings
  for each row execute function public.krakatoa_set_updated_at();

-- Seed the single global row with all-NULL durations (nothing expires by
-- default until an admin sets a value). Idempotent.
insert into expiry_settings (key)
values ('global')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- RLS — deny-by-default. Server routes use the service role; no public policies.
-- ---------------------------------------------------------------------------
alter table expiry_settings enable row level security;
