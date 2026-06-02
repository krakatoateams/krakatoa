-- 004_credits.sql
-- Krakatoa credit-system foundation (single-user, NextAuth-only).
-- Ownership boundary = profile_id (same as 003). Service routes use the
-- Supabase service role and enforce profile ownership in application code.
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).
-- Billing model:
--   * credit_transactions = the BILLING SOURCE OF TRUTH (append-mostly ledger).
--   * credit_wallets.balance = fast-read cache, kept in sync by the RPC.
--   * usage_events = analytics/cost visibility only; never affects balance.
--   * jobs.cost_credits / assets.cost_credits remain display snapshots only.
--
-- This phase is foundation only: nothing here is wired into generation routes.

-- gen_random_uuid() lives in pgcrypto on some Postgres setups; ensure available.
create extension if not exists pgcrypto;

-- Re-declare the shared updated_at trigger helper (idempotent; matches 003's
-- search_path hardening) so this migration is safe even if applied standalone.
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
-- 1) credit_wallets  (fast-read balance per profile; ledger is source of truth)
-- ---------------------------------------------------------------------------
create table if not exists credit_wallets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid unique not null references profiles (id) on delete cascade,
  balance int not null default 0 check (balance >= 0),
  lifetime_purchased int not null default 0,
  lifetime_spent int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists credit_wallets_profile_idx on credit_wallets (profile_id);

drop trigger if exists credit_wallets_set_updated_at on credit_wallets;
create trigger credit_wallets_set_updated_at
  before update on credit_wallets
  for each row execute function public.krakatoa_set_updated_at();

-- ---------------------------------------------------------------------------
-- 2) credit_transactions  (append-mostly ledger — BILLING SOURCE OF TRUTH)
--    amount is a positive magnitude; `direction` carries the sign.
-- ---------------------------------------------------------------------------
create table if not exists credit_transactions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  job_id uuid references jobs (id) on delete set null,
  asset_id uuid references assets (id) on delete set null,
  amount int not null check (amount > 0),
  direction text not null check (direction in ('credit', 'debit')),
  type text not null
    check (type in ('purchase', 'spend', 'refund', 'bonus', 'adjustment', 'expiry')),
  status text not null default 'succeeded'
    check (status in ('pending', 'succeeded', 'failed', 'reversed')),
  description text,
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);

create index if not exists credit_tx_profile_created_idx
  on credit_transactions (profile_id, created_at desc);
create index if not exists credit_tx_type_idx
  on credit_transactions (profile_id, type, created_at desc);
create index if not exists credit_tx_job_idx on credit_transactions (job_id);
create index if not exists credit_tx_asset_idx on credit_transactions (asset_id);
create index if not exists credit_tx_metadata_gin
  on credit_transactions using gin (metadata jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- 3) usage_events  (provider/model usage + estimated cost; analytics ONLY)
-- ---------------------------------------------------------------------------
create table if not exists usage_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  job_id uuid references jobs (id) on delete set null,
  asset_id uuid references assets (id) on delete set null,
  tool text not null,
  provider text,
  model text,
  unit_type text,
  units numeric,
  estimated_cost_usd numeric,
  credits_charged int,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists usage_events_profile_created_idx
  on usage_events (profile_id, created_at desc);
create index if not exists usage_events_job_idx on usage_events (job_id);
create index if not exists usage_events_asset_idx on usage_events (asset_id);
create index if not exists usage_events_tool_idx
  on usage_events (profile_id, tool, created_at desc);
create index if not exists usage_events_metadata_gin
  on usage_events using gin (metadata jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- 4) krakatoa_apply_credit_transaction  (transactional + idempotent mutation)
--    Runs in a single implicit transaction. Fully schema-qualified because
--    search_path is pinned to '' for the Supabase security linter.
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_apply_credit_transaction(
  p_profile_id uuid,
  p_amount int,
  p_direction text,
  p_type text,
  p_status text default 'succeeded',
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_job_id uuid default null,
  p_asset_id uuid default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_wallet public.credit_wallets;
  v_tx public.credit_transactions;
  v_existing public.credit_transactions;
begin
  -- Explicit input validation for clearer errors than raw constraint failures.
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT: amount must be a positive integer';
  end if;
  if p_direction is null or p_direction not in ('credit', 'debit') then
    raise exception 'INVALID_DIRECTION: must be credit or debit';
  end if;
  if p_type is null or p_type not in ('purchase', 'spend', 'refund', 'bonus', 'adjustment', 'expiry') then
    raise exception 'INVALID_TYPE: unsupported transaction type';
  end if;
  if p_status is null or p_status not in ('pending', 'succeeded', 'failed', 'reversed') then
    raise exception 'INVALID_STATUS: unsupported transaction status';
  end if;

  -- Idempotency replay: return the prior result, never double-apply.
  if p_idempotency_key is not null then
    select * into v_existing
    from public.credit_transactions
    where idempotency_key = p_idempotency_key;
    if found then
      select * into v_wallet
      from public.credit_wallets
      where profile_id = v_existing.profile_id;
      return jsonb_build_object(
        'transaction', to_jsonb(v_existing),
        'wallet', to_jsonb(v_wallet),
        'replayed', true
      );
    end if;
  end if;

  -- Ensure the wallet exists, then lock it for the balance mutation.
  insert into public.credit_wallets (profile_id)
  values (p_profile_id)
  on conflict (profile_id) do nothing;

  select * into v_wallet
  from public.credit_wallets
  where profile_id = p_profile_id
  for update;

  -- Only succeeded transactions move the balance. pending/failed/reversed are
  -- recorded but inert in this phase (no reservation/reversal semantics yet).
  if p_status = 'succeeded' then
    if p_direction = 'debit' then
      if v_wallet.balance < p_amount then
        raise exception 'INSUFFICIENT_CREDITS';
      end if;
      update public.credit_wallets
      set balance = balance - p_amount,
          lifetime_spent = lifetime_spent + (case when p_type = 'spend' then p_amount else 0 end)
      where profile_id = p_profile_id;
    else
      update public.credit_wallets
      set balance = balance + p_amount,
          lifetime_purchased = lifetime_purchased + (case when p_type = 'purchase' then p_amount else 0 end)
      where profile_id = p_profile_id;
    end if;
  end if;

  insert into public.credit_transactions (
    profile_id, job_id, asset_id, amount, direction, type, status,
    description, metadata, idempotency_key
  ) values (
    p_profile_id, p_job_id, p_asset_id, p_amount, p_direction, p_type, p_status,
    p_description, coalesce(p_metadata, '{}'::jsonb), p_idempotency_key
  ) returning * into v_tx;

  select * into v_wallet
  from public.credit_wallets
  where profile_id = p_profile_id;

  return jsonb_build_object(
    'transaction', to_jsonb(v_tx),
    'wallet', to_jsonb(v_wallet),
    'replayed', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) Backfill: one zero-balance wallet per existing profile (idempotent).
--    No synthetic credit_transactions are created for backfilled zeros.
-- ---------------------------------------------------------------------------
insert into credit_wallets (profile_id, balance)
select p.id, 0
from profiles p
where not exists (
  select 1 from credit_wallets w where w.profile_id = p.id
);

-- ---------------------------------------------------------------------------
-- 6) RLS — deny-by-default on all new tables. Server routes use the service
--    role (which bypasses RLS) and enforce profile ownership in app code.
--    No anon/authenticated policies are created.
-- ---------------------------------------------------------------------------
alter table credit_wallets      enable row level security;
alter table credit_transactions enable row level security;
alter table usage_events        enable row level security;
