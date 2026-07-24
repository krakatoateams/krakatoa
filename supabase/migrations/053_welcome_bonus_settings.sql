-- 053_welcome_bonus_settings.sql
-- Admin-configurable "Welcome bonus" for new (regular) users.
--
-- Adds a singleton settings table (key='global', mirroring expiry_settings/048
-- and billing_settings/009) holding:
--   * enabled       — master on/off switch for the welcome bonus
--   * credit_amount — credits granted to each new NON-admin profile when enabled
--
-- Then redefines the new-profile seed trigger (from 006/024/051) so that:
--   * active admins STILL receive the internal 500 dummy-credit seed (unchanged);
--   * regular users receive `credit_amount` credits ONLY when `enabled` is true
--     and the amount is > 0 (otherwise they start at 0, as before).
-- Both grants are tagged source='new_user_bonus' and expire per
-- expiry_settings.new_user_bonus_credit_days (NULL => never).
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).
-- Security model (unchanged): RLS enabled deny-by-default with NO policies;
-- server routes use the service role and enforce admin access in app code.

create extension if not exists pgcrypto;

-- Shared updated_at trigger helper (re-declared idempotently; also in 048).
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
-- welcome_bonus_settings — singleton config for the new-user welcome bonus.
--   The `check (key = 'global')` guard makes this a single-row table.
-- ---------------------------------------------------------------------------
create table if not exists welcome_bonus_settings (
  key text primary key default 'global' check (key = 'global'),
  enabled boolean not null default false,
  credit_amount int not null default 0 check (credit_amount >= 0),
  updated_by_profile_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists welcome_bonus_settings_set_updated_at on welcome_bonus_settings;
create trigger welcome_bonus_settings_set_updated_at
  before update on welcome_bonus_settings
  for each row execute function public.krakatoa_set_updated_at();

-- Seed the single global row disabled (preserves current behaviour: regular
-- users start at 0 until an admin enables the bonus). Idempotent.
insert into welcome_bonus_settings (key, enabled, credit_amount)
values ('global', false, 0)
on conflict (key) do nothing;

alter table welcome_bonus_settings enable row level security;

-- ---------------------------------------------------------------------------
-- Redefine the new-profile seed trigger to honour the welcome-bonus config.
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_seed_initial_credits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_days int;
  v_expires_at timestamptz;
  v_enabled boolean;
  v_amount int;
begin
  -- Active admins/owners (case-insensitive email match against admin_users).
  select exists (
    select 1
    from public.admin_users a
    where a.status = 'active'
      and lower(a.email) = lower(coalesce(new.email, ''))
  )
  into v_is_admin;

  -- New-user bonus expiry (shared by the admin seed and the welcome bonus).
  -- NULL/<=0 => never expires.
  select new_user_bonus_credit_days into v_days
  from public.expiry_settings
  where key = 'global';

  if v_days is not null and v_days > 0 then
    v_expires_at := now() + make_interval(days => v_days);
  else
    v_expires_at := null;
  end if;

  if v_is_admin then
    -- Internal testing seed: active admins always receive 500 dummy credits.
    perform public.krakatoa_apply_credit_transaction(
      p_profile_id      => new.id,
      p_amount          => 500,
      p_direction       => 'credit',
      p_type            => 'bonus',
      p_status          => 'succeeded',
      p_description     => 'Initial dummy credits (admin)',
      p_metadata        => jsonb_build_object('source', 'profile_after_insert_admin'),
      p_idempotency_key => 'seed:initial_500:' || new.id::text,
      p_source          => 'new_user_bonus',
      p_expires_at      => v_expires_at
    );
    return new;
  end if;

  -- Regular user: grant the admin-configured welcome bonus when enabled.
  select enabled, credit_amount into v_enabled, v_amount
  from public.welcome_bonus_settings
  where key = 'global';

  if coalesce(v_enabled, false) and coalesce(v_amount, 0) > 0 then
    perform public.krakatoa_apply_credit_transaction(
      p_profile_id      => new.id,
      p_amount          => v_amount,
      p_direction       => 'credit',
      p_type            => 'bonus',
      p_status          => 'succeeded',
      p_description     => 'Welcome bonus',
      p_metadata        => jsonb_build_object('source', 'welcome_bonus'),
      p_idempotency_key => 'seed:welcome_bonus:' || new.id::text,
      p_source          => 'new_user_bonus',
      p_expires_at      => v_expires_at
    );
  end if;

  return new;
end;
$$;

-- Re-assert the trigger idempotently (unchanged wiring from 006/024/051).
drop trigger if exists profiles_seed_initial_credits on public.profiles;
create trigger profiles_seed_initial_credits
  after insert on public.profiles
  for each row execute function public.krakatoa_seed_initial_credits();
