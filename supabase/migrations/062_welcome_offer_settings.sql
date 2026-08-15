-- 062_welcome_offer_settings.sql
-- Admin-configurable master switch for the "Welcome offer" promo popup
-- (components/PromoOfferModal, shown once per session on the dashboard).
--
-- Adds a singleton settings table (key='global', mirroring welcome_bonus_settings/053
-- and expiry_settings/048) holding:
--   * enabled — master on/off switch for the welcome offer popup
--
-- This is purely presentational marketing config: it gates whether the promo
-- modal auto-opens. It never affects billing — the Claim CTA still resolves the
-- real, server-authoritative pack price via /api/credits/checkout.
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).
-- Security model (unchanged): RLS enabled deny-by-default with NO policies;
-- server routes use the service role and enforce admin access in app code.

create extension if not exists pgcrypto;

-- Shared updated_at trigger helper (re-declared idempotently; also in 048/053).
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
-- welcome_offer_settings — singleton config for the welcome-offer promo popup.
--   The `check (key = 'global')` guard makes this a single-row table.
-- ---------------------------------------------------------------------------
create table if not exists welcome_offer_settings (
  key text primary key default 'global' check (key = 'global'),
  enabled boolean not null default true,
  updated_by_profile_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists welcome_offer_settings_set_updated_at on welcome_offer_settings;
create trigger welcome_offer_settings_set_updated_at
  before update on welcome_offer_settings
  for each row execute function public.krakatoa_set_updated_at();

-- Seed the single global row enabled (preserves current behaviour: the promo
-- was live via the PROMO_ENABLED code constant). Idempotent.
insert into welcome_offer_settings (key, enabled)
values ('global', true)
on conflict (key) do nothing;

alter table welcome_offer_settings enable row level security;
