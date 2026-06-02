-- 006_dummy_credits.sql
-- Grant 500 dummy credits to every existing profile, and auto-grant 500 to any
-- future profile, via the ledger RPC. This is the internal-testing phase: no
-- payment gateway exists yet, so every profile needs a non-zero balance to
-- exercise the spend/refund paths in the generation routes.
--
-- Billing model (unchanged):
--   - credit_transactions = BILLING SOURCE OF TRUTH (ledger).
--   - credit_wallets.balance is a fast-read cache kept in sync by the RPC.
--   - This migration NEVER touches credit_wallets.balance directly — every
--     mutation goes through public.krakatoa_apply_credit_transaction so the
--     ledger row and the cached balance move atomically.
--
-- Idempotency:
--   - Each grant uses idempotency_key = 'seed:initial_500:' || profile_id.
--   - The RPC returns the prior result on a duplicate key (no balance movement,
--     no extra ledger row). Re-running this migration is a no-op for any
--     profile that already received its bonus.
--
-- Additive and safe to re-run via `npm run db:setup`.

-- ---------------------------------------------------------------------------
-- 1) Backfill: 500 dummy credits for every existing profile.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select id from public.profiles loop
    perform public.krakatoa_apply_credit_transaction(
      p_profile_id      => r.id,
      p_amount          => 500,
      p_direction       => 'credit',
      p_type            => 'bonus',
      p_status          => 'succeeded',
      p_description     => 'Initial dummy credits',
      p_metadata        => jsonb_build_object('source', 'seed_initial_500'),
      p_idempotency_key => 'seed:initial_500:' || r.id::text
    );
  end loop;
end$$;

-- ---------------------------------------------------------------------------
-- 2) Auto-grant trigger for future profiles.
--    Fires after each profiles insert and routes through the same idempotent
--    RPC, so a future "real" onboarding signup also lands on 500 credits with
--    one bonus ledger row. Same key as the backfill: a row inserted by both
--    paths (e.g. backfill then re-creation under the same id) still only gets
--    one bonus.
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_seed_initial_credits()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.krakatoa_apply_credit_transaction(
    p_profile_id      => new.id,
    p_amount          => 500,
    p_direction       => 'credit',
    p_type            => 'bonus',
    p_status          => 'succeeded',
    p_description     => 'Initial dummy credits',
    p_metadata        => jsonb_build_object('source', 'profile_after_insert'),
    p_idempotency_key => 'seed:initial_500:' || new.id::text
  );
  return new;
end;
$$;

drop trigger if exists profiles_seed_initial_credits on public.profiles;
create trigger profiles_seed_initial_credits
  after insert on public.profiles
  for each row execute function public.krakatoa_seed_initial_credits();
