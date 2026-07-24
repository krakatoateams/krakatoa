-- 050_credit_lots_rpc.sql
-- Make the credit RPC lot-aware, and add the lot-expiry function.
--
-- Backward-compatible: `krakatoa_apply_credit_transaction` keeps its existing
-- behavior (idempotency, balance/lifetime math, INSUFFICIENT_CREDITS) and gains
-- two optional params:
--   p_source      — lot source tag for credits (defaults derived from p_type)
--   p_expires_at  — absolute expiry for the created lot (NULL = never)
--
-- Additionally, once per succeeded transaction:
--   * credit -> insert a credit_lots row (amount_remaining = amount)
--   * debit  -> consume active lots (soonest expiry first, then oldest)
-- credit_wallets.balance math is UNCHANGED (still the authoritative cache); the
-- lot bookkeeping runs alongside it and stays consistent because backfill (049)
-- seeded lots == balance and every credit/debit now maintains both.
--
-- Idempotent (create or replace). Safe to re-run via `npm run db:setup`.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- krakatoa_apply_credit_transaction (lot-aware)
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
  p_asset_id uuid default null,
  p_source text default null,
  p_expires_at timestamptz default null
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_wallet public.credit_wallets;
  v_tx public.credit_transactions;
  v_existing public.credit_transactions;
  v_source text;
  v_remaining int;
  v_take int;
  v_lot record;
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
  -- recorded but inert (no reservation/reversal semantics yet).
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

  -- Lot bookkeeping (only for balance-moving, succeeded rows).
  if p_status = 'succeeded' then
    if p_direction = 'credit' then
      -- Derive a lot source from the type when the caller did not specify one.
      v_source := coalesce(
        p_source,
        case
          when p_type = 'purchase' then 'regular'
          when p_type = 'refund' then 'refund'
          when p_type = 'adjustment' then 'adjustment'
          when p_type = 'bonus' then 'new_user_bonus'
          else 'adjustment'
        end
      );
      insert into public.credit_lots (
        profile_id, source, amount_granted, amount_remaining, expires_at, status, source_tx_id
      ) values (
        p_profile_id, v_source, p_amount, p_amount, p_expires_at, 'active', v_tx.id
      );
    else
      -- Consume active lots, soonest expiry first (NULLs last), then oldest.
      v_remaining := p_amount;
      for v_lot in
        select id, amount_remaining
        from public.credit_lots
        where profile_id = p_profile_id
          and status = 'active'
          and amount_remaining > 0
        order by expires_at asc nulls last, created_at asc
        for update
      loop
        exit when v_remaining <= 0;
        v_take := least(v_lot.amount_remaining, v_remaining);
        update public.credit_lots
        set amount_remaining = amount_remaining - v_take,
            status = case when amount_remaining - v_take = 0 then 'exhausted' else status end
        where id = v_lot.id;
        v_remaining := v_remaining - v_take;
      end loop;
      -- If lots under-cover the debit (should not happen once backfilled), the
      -- authoritative balance cache above has already been decremented; we do
      -- not fail the transaction on a lot/balance drift.
    end if;
  end if;

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
-- krakatoa_expire_credit_lots — expire all lots whose expires_at has passed.
--   For each expired lot with amount_remaining > 0:
--     * write a debit credit_transactions row (type='expiry', idempotent key
--       'expiry:lot:{lot_id}')
--     * reduce credit_wallets.balance by the remaining amount
--     * set the lot status='expired', amount_remaining=0
--   Returns a summary { lots_expired, credits_expired, profiles_affected }.
--   Transactional as a whole (single statement-level function invocation).
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_expire_credit_lots(
  p_now timestamptz default now(),
  p_dry_run boolean default false
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_lot record;
  v_lots_expired int := 0;
  v_credits_expired bigint := 0;
  v_profiles jsonb := '{}'::jsonb;
begin
  for v_lot in
    select id, profile_id, amount_remaining
    from public.credit_lots
    where status = 'active'
      and amount_remaining > 0
      and expires_at is not null
      and expires_at <= p_now
    order by profile_id, expires_at
    for update
  loop
    v_lots_expired := v_lots_expired + 1;
    v_credits_expired := v_credits_expired + v_lot.amount_remaining;
    v_profiles := jsonb_set(
      v_profiles,
      array[v_lot.profile_id::text],
      to_jsonb(coalesce((v_profiles ->> v_lot.profile_id::text)::int, 0) + v_lot.amount_remaining)
    );

    if p_dry_run then
      continue;
    end if;

    -- Ledger row (source of truth). Idempotent per lot.
    insert into public.credit_transactions (
      profile_id, amount, direction, type, status, description, metadata, idempotency_key
    ) values (
      v_lot.profile_id, v_lot.amount_remaining, 'debit', 'expiry', 'succeeded',
      'Credit expiry', jsonb_build_object('source', 'credit_expiry', 'lot_id', v_lot.id),
      'expiry:lot:' || v_lot.id::text
    )
    on conflict (idempotency_key) do nothing;

    -- Reduce the cached balance (never below zero as a safety clamp).
    update public.credit_wallets
    set balance = greatest(0, balance - v_lot.amount_remaining)
    where profile_id = v_lot.profile_id;

    -- Mark the lot expired and drained.
    update public.credit_lots
    set status = 'expired', amount_remaining = 0
    where id = v_lot.id;
  end loop;

  return jsonb_build_object(
    'lots_expired', v_lots_expired,
    'credits_expired', v_credits_expired,
    'profiles_affected', (select count(*) from jsonb_object_keys(v_profiles)),
    'dry_run', p_dry_run
  );
end;
$$;
