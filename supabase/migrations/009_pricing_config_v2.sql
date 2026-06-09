-- 009_pricing_config_v2.sql
-- Pricing Config v2.1 — Provider-Cost-Based Pricing.
--
-- Moves Krakatoa from coarse integer credit pricing to provider-cost-based
-- pricing. Credits are derived from the provider's USD cost via the shared
-- formula (see lib/pricing-math.ts):
--
--   credits = ceil(provider_cost_usd * unit_count * usd_to_idr
--                  * margin_multiplier / credit_value_idr)
--
-- With the current internal-testing knobs (usd_to_idr=18000, credit_value_idr=200,
-- margin_multiplier=1.0) this simplifies to: credits = ceil(cost_usd * units * 90).
-- Rounding happens ONLY once, at the final charge (no per-second rounding).
--
-- Additive and non-destructive:
--   * create table if not exists / add column if not exists / create index if not exists
--   * does NOT drop or alter existing columns; keeps legacy credit_amount + pricing_type
--   * idempotent seeds (on conflict do nothing) — safe to re-run via `npm run db:setup`
--
-- Backward compatibility:
--   * Legacy rows (product_photo, storyboard_image, storyboard_video,
--     seedance_video_per_second, veo_video_per_second, initial_dummy_credits)
--     stay in place and are used as a fallback.
--   * Each v2 row also carries a sensible legacy credit_amount so the resolver's
--     fallback path still produces a usable number when provider_cost_usd /
--     billing_settings are unavailable. provider_cost_usd is authoritative.
--
-- Security model (unchanged from 003/004/007): RLS is enabled deny-by-default with
-- NO policies. Server routes use the Supabase service role (which bypasses RLS)
-- and enforce access in application code. billing_settings has no public policies.

-- gen_random_uuid() lives in pgcrypto on some Postgres setups; ensure available.
create extension if not exists pgcrypto;

-- Project-specific updated_at trigger helper. Already created by 003/004/007;
-- re-declared here (idempotent) so this migration is safe to apply on its own.
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
-- 1) billing_settings — singleton table of global pricing knobs.
--    The `check (key = 'global')` guard makes this a single-row table.
-- ---------------------------------------------------------------------------
create table if not exists billing_settings (
  key text primary key default 'global' check (key = 'global'),
  usd_to_idr numeric not null default 18000,
  credit_value_idr numeric not null default 200,
  margin_multiplier numeric not null default 1.0,
  rounding_mode text not null default 'ceil_final' check (rounding_mode in ('ceil_final')),
  updated_by_profile_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists billing_settings_set_updated_at on billing_settings;
create trigger billing_settings_set_updated_at
  before update on billing_settings
  for each row execute function public.krakatoa_set_updated_at();

-- Seed the single global row (idempotent). Defaults match the internal-testing
-- assumptions: Rp18.000/USD, Rp200/credit, margin 1.0 (1:1 provider cost).
insert into billing_settings (key, usd_to_idr, credit_value_idr, margin_multiplier, rounding_mode)
values ('global', 18000, 200, 1.0, 'ceil_final')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 2) pricing_configs — add v2 provider-cost columns. credit_amount and
--    pricing_type are RETAINED for backward-compatible fallback.
-- ---------------------------------------------------------------------------
alter table pricing_configs add column if not exists provider_cost_usd numeric;
alter table pricing_configs add column if not exists cost_unit text;
alter table pricing_configs add column if not exists pricing_group text;
alter table pricing_configs add column if not exists variant_key text;
alter table pricing_configs add column if not exists currency text not null default 'USD';

-- cost_unit enum guard. Postgres has no "add constraint if not exists", so guard
-- it in a DO block to keep this migration idempotent.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pricing_configs_cost_unit_check'
  ) then
    alter table pricing_configs
      add constraint pricing_configs_cost_unit_check
      check (cost_unit is null or cost_unit in ('per_image', 'per_second', 'per_run', 'per_1k_tokens'));
  end if;
end
$$;

create index if not exists pricing_configs_group_idx on pricing_configs (pricing_group);

-- ---------------------------------------------------------------------------
-- 3) Seed v2 pricing rows (idempotent). credit_amount is a legacy fallback only;
--    provider_cost_usd is authoritative for the v2 resolver path. Fallback
--    amounts = ceil(provider_cost_usd * 90) per current internal-testing knobs.
-- ---------------------------------------------------------------------------
insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  -- Seedance (per second)
  ('seedance_480p_per_second', 'Seedance 480p (per sec)',  'per_second', 7,  0.07, 'per_second', 'seedance',         '480p', 'USD'),
  ('seedance_720p_per_second', 'Seedance 720p (per sec)',  'per_second', 14, 0.15, 'per_second', 'seedance',         '720p', 'USD'),
  -- Veo (per second)
  ('veo_720p_per_second',      'Veo 720p (per sec)',       'per_second', 5,  0.05, 'per_second', 'veo',              '720p', 'USD'),
  ('veo_1080p_per_second',     'Veo 1080p (per sec)',      'per_second', 8,  0.08, 'per_second', 'veo',              '1080p','USD'),
  -- Storyboard / GPT Image 2 (per image)
  ('storyboard_gpt_image_2_low_per_image',    'Storyboard Image — Low',    'per_image', 2,  0.012, 'per_image', 'storyboard_image', 'low',    'USD'),
  ('storyboard_gpt_image_2_medium_per_image', 'Storyboard Image — Medium', 'per_image', 5,  0.047, 'per_image', 'storyboard_image', 'medium', 'USD'),
  ('storyboard_gpt_image_2_auto_per_image',   'Storyboard Image — Auto',   'per_image', 12, 0.128, 'per_image', 'storyboard_image', 'auto',   'USD'),
  -- Product Photo / Nano Banana Pro (per image)
  ('product_photo_fallback_per_image', 'Product Photo — Fallback/Low', 'per_image', 4,  0.035, 'per_image', 'product_photo', 'fallback', 'USD'),
  ('product_photo_1k_per_image',       'Product Photo — 1K',           'per_image', 14, 0.15,  'per_image', 'product_photo', '1k',       'USD'),
  ('product_photo_2k_per_image',       'Product Photo — 2K',           'per_image', 14, 0.15,  'per_image', 'product_photo', '2k',       'USD'),
  ('product_photo_4k_per_image',       'Product Photo — 4K',           'per_image', 27, 0.30,  'per_image', 'product_photo', '4k',       'USD')
on conflict (pricing_key) do nothing;

-- Backfill v2 metadata onto existing legacy rows where it is unambiguous and they
-- were seeded by 007 without v2 fields. Only fills NULLs (never clobbers admin
-- edits) and never touches credit_amount / pricing_type / enabled.
update pricing_configs set cost_unit = 'per_second', pricing_group = 'seedance'
  where pricing_key = 'seedance_video_per_second' and cost_unit is null;
update pricing_configs set cost_unit = 'per_second', pricing_group = 'veo'
  where pricing_key = 'veo_video_per_second' and cost_unit is null;
update pricing_configs set cost_unit = 'per_image', pricing_group = 'storyboard_image'
  where pricing_key = 'storyboard_image' and cost_unit is null;
update pricing_configs set cost_unit = 'per_image', pricing_group = 'product_photo'
  where pricing_key = 'product_photo' and cost_unit is null;

-- ---------------------------------------------------------------------------
-- 4) RLS — deny-by-default on billing_settings. Server routes use the service
--    role (which bypasses RLS); no anon/authenticated policies are created.
-- ---------------------------------------------------------------------------
alter table billing_settings enable row level security;
