-- 043_credit_orders.sql
-- Credit purchase orders for the DOKU Checkout flow.
-- Ownership boundary = profile_id (same as 004). Service routes use the Supabase
-- service role and enforce profile ownership in application code.
--
-- Lifecycle: a row is created 'pending' when the user starts checkout, then the
-- signature-verified DOKU notification moves it to 'paid' (and credits the
-- wallet via krakatoa_apply_credit_transaction) or 'failed'/'expired'. The
-- wallet is NEVER credited from the browser redirect — only from the webhook.
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).

create extension if not exists pgcrypto;

-- Re-declare the shared updated_at trigger helper (idempotent; matches 003/004).
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

create table if not exists credit_orders (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  -- Pack id from lib/credit-packs.ts (server-authoritative; not trusted from client).
  pack_id text not null,
  credits int not null check (credits > 0),
  amount_idr int not null check (amount_idr > 0),
  currency text not null default 'IDR',
  -- Our generated invoice number, also sent to DOKU as order.invoice_number.
  invoice_number text unique not null,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'failed', 'expired')),
  payment_method text,
  doku_token_id text,
  -- The credit ledger row created on fulfillment (audit link; nullable).
  credit_transaction_id uuid references credit_transactions (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists credit_orders_profile_created_idx
  on credit_orders (profile_id, created_at desc);
create index if not exists credit_orders_status_idx
  on credit_orders (status, created_at desc);
-- invoice_number already has a unique index from the column constraint.

drop trigger if exists credit_orders_set_updated_at on credit_orders;
create trigger credit_orders_set_updated_at
  before update on credit_orders
  for each row execute function public.krakatoa_set_updated_at();

-- RLS — deny-by-default. Server routes use the service role (bypasses RLS) and
-- enforce profile ownership in app code. No anon/authenticated policies.
alter table credit_orders enable row level security;
