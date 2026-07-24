-- 052_credit_packs.sql
-- Admin-managed credit purchase tiers (the "Buy credits" packs).
--
-- Moves the credit packs from the static lib/credit-packs.ts array into a table
-- so admins can edit price / credits / bonus / label / ordering / visibility from
-- the admin Pricing tab. The static array remains the code-level fallback (used
-- when the table is unavailable) and the seed source below.
--
-- pack_id is referenced by credit_orders.pack_id as plain text (NOT a FK) and
-- orders snapshot credits/amount at purchase time, so editing or removing a tier
-- never breaks historical orders.
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).
-- Security model (unchanged): RLS enabled deny-by-default with NO policies.
-- Server routes use the service role; the public packs API reads via the service
-- role and returns only active tiers.

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

-- ---------------------------------------------------------------------------
-- credit_packs — one row per purchasable tier. `id` is a stable text slug that
--   credit_orders.pack_id references; it must never change once orders exist.
-- ---------------------------------------------------------------------------
create table if not exists credit_packs (
  id text primary key,
  credits int not null check (credits > 0),
  bonus_credits int not null default 0 check (bonus_credits >= 0),
  price_idr int not null check (price_idr >= 0),
  label text not null,
  popular boolean not null default false,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_packs_active_sort_idx
  on credit_packs (is_active, sort_order);

drop trigger if exists credit_packs_set_updated_at on credit_packs;
create trigger credit_packs_set_updated_at
  before update on credit_packs
  for each row execute function public.krakatoa_set_updated_at();

-- Seed the current static tiers (idempotent; never clobbers admin edits).
insert into credit_packs (id, credits, bonus_credits, price_idr, label, popular, is_active, sort_order)
values
  ('p1', 100,  0,   27000,  'Starter', false, true, 0),
  ('p3', 250,  0,   67500,  'Creator', true,  true, 1),
  ('p4', 500,  25,  135000, 'Pro',     false, true, 2),
  ('p5', 1000, 100, 270000, 'Studio',  false, true, 3)
on conflict (id) do nothing;

alter table credit_packs enable row level security;
