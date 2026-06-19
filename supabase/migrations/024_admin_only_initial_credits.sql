-- 024_admin_only_initial_credits.sql
-- Restrict the auto-granted 500 "dummy" credits to ADMINS / OWNERS only.
--
-- Background: 006_dummy_credits.sql seeded 500 credits to every existing profile
-- and added an after-insert trigger that granted 500 to EVERY new profile. During
-- the internal-testing phase that was fine, but going forward only admins/owners
-- (rows in admin_users with status='active') should receive the dummy bonus.
-- Regular users start at a 0 balance until a payment/onboarding flow grants them
-- credits — there is no payment gateway yet, so non-admins simply have no balance.
--
-- This migration only redefines the trigger function. It does NOT touch any
-- existing balances: the only profiles that exist today are the seeded admins,
-- so there is nothing to claw back. Admins can top-up/reset their own (or other
-- admins') dummy balance from the admin panel (Credits tab → set/reset).
--
-- Additive and safe to re-run via `npm run db:setup`.
--
-- Billing model (unchanged):
--   - credit_transactions = BILLING SOURCE OF TRUTH (ledger).
--   - credit_wallets.balance is a fast-read cache kept in sync by the RPC.
--   - This trigger NEVER touches credit_wallets.balance directly — every mutation
--     goes through public.krakatoa_apply_credit_transaction.
--
-- Idempotency:
--   - Same key as 006: 'seed:initial_500:' || profile_id. A profile that already
--     received the bonus (e.g. an admin seeded in 006) never gets a second one.

create or replace function public.krakatoa_seed_initial_credits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_admin boolean;
begin
  -- Only active admins/owners receive the dummy seed credits. The check is by
  -- email (admin_users is the source of truth and is keyed by email) and is
  -- case-insensitive to tolerate provider casing differences.
  select exists (
    select 1
    from public.admin_users a
    where a.status = 'active'
      and lower(a.email) = lower(coalesce(new.email, ''))
  )
  into v_is_admin;

  if not v_is_admin then
    -- Regular user: no auto-grant. They start at a 0 balance.
    return new;
  end if;

  perform public.krakatoa_apply_credit_transaction(
    p_profile_id      => new.id,
    p_amount          => 500,
    p_direction       => 'credit',
    p_type            => 'bonus',
    p_status          => 'succeeded',
    p_description     => 'Initial dummy credits (admin)',
    p_metadata        => jsonb_build_object('source', 'profile_after_insert_admin'),
    p_idempotency_key => 'seed:initial_500:' || new.id::text
  );
  return new;
end;
$$;

-- Trigger definition itself is unchanged from 006; re-assert it idempotently so
-- this migration is safe to apply standalone.
drop trigger if exists profiles_seed_initial_credits on public.profiles;
create trigger profiles_seed_initial_credits
  after insert on public.profiles
  for each row execute function public.krakatoa_seed_initial_credits();
