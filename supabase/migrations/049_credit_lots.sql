-- 049_credit_lots.sql
-- Credit "lot" ledger — per-source credit expiry (Expiry Management).
--
-- Each incoming credit grant becomes a lot carrying its source and its own
-- expires_at. Spends consume lots (soonest-expiring first). A daily cron expires
-- lots whose expires_at has passed. This is the detail layer beneath the fungible
-- credit_wallets.balance cache:
--
--   credit_wallets.balance  == sum(active credit_lots.amount_remaining)
--
-- The RPC (050) keeps them in lockstep; this migration only creates the table
-- and backfills existing balances as never-expiring "legacy" lots so nobody is
-- retroactively drained at rollout.
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).
-- Security model (unchanged): RLS enabled deny-by-default with NO policies.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- credit_lots — one row per credit grant. amount_remaining is decremented as
--   the lot is consumed by spends; zeroed when exhausted or expired.
-- ---------------------------------------------------------------------------
create table if not exists credit_lots (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  source text not null
    check (source in ('regular', 'purchase_bonus', 'new_user_bonus', 'refund', 'adjustment', 'legacy')),
  amount_granted int not null check (amount_granted > 0),
  amount_remaining int not null check (amount_remaining >= 0),
  expires_at timestamptz,
  status text not null default 'active'
    check (status in ('active', 'exhausted', 'expired')),
  source_tx_id uuid references credit_transactions (id) on delete set null,
  created_at timestamptz not null default now()
);

-- Consumption order (soonest expiry first, then oldest) and expiry scans.
create index if not exists credit_lots_consume_idx
  on credit_lots (profile_id, status, expires_at, created_at);
create index if not exists credit_lots_expiry_scan_idx
  on credit_lots (status, expires_at)
  where status = 'active';
create index if not exists credit_lots_profile_idx on credit_lots (profile_id);

-- ---------------------------------------------------------------------------
-- Backfill: one never-expiring "legacy" lot per wallet equal to the current
-- balance, so sum(active lot remaining) == balance from day one. Skipped for
-- wallets that already have any lot (idempotent re-run safety) and for zero
-- balances (no lot needed).
-- ---------------------------------------------------------------------------
insert into credit_lots (profile_id, source, amount_granted, amount_remaining, expires_at, status)
select w.profile_id, 'legacy', w.balance, w.balance, null, 'active'
from credit_wallets w
where w.balance > 0
  and not exists (select 1 from credit_lots l where l.profile_id = w.profile_id);

-- ---------------------------------------------------------------------------
-- RLS — deny-by-default. Server routes use the service role; no public policies.
-- ---------------------------------------------------------------------------
alter table credit_lots enable row level security;
