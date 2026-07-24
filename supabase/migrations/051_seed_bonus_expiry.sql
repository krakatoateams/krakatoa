-- 051_seed_bonus_expiry.sql
-- Tag the auto-granted new-user bonus as a 'new_user_bonus' credit lot and apply
-- the admin-configured expiry to it.
--
-- Redefines the seed trigger function from 006/024 so that the 500 dummy credits
-- granted to new admin profiles are stamped with:
--   * p_source => 'new_user_bonus'  (so the lot lands in the right expiry bucket)
--   * p_expires_at => now() + expiry_settings.new_user_bonus_credit_days
--       (NULL when unset -> never expires)
--
-- Everything else is unchanged from 024 (admin-only gate, same idempotency key,
-- never touches credit_wallets.balance directly). Additive, idempotent.

create or replace function public.krakatoa_seed_initial_credits()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_is_admin boolean;
  v_days int;
  v_expires_at timestamptz;
begin
  -- Only active admins/owners receive the dummy seed credits (case-insensitive
  -- email match against admin_users, the source of truth).
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

  -- Resolve the configured new-user bonus expiry (days). NULL/<=0 => never.
  select new_user_bonus_credit_days into v_days
  from public.expiry_settings
  where key = 'global';

  if v_days is not null and v_days > 0 then
    v_expires_at := now() + make_interval(days => v_days);
  else
    v_expires_at := null;
  end if;

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
end;
$$;

-- Re-assert the trigger idempotently (unchanged from 006/024).
drop trigger if exists profiles_seed_initial_credits on public.profiles;
create trigger profiles_seed_initial_credits
  after insert on public.profiles
  for each row execute function public.krakatoa_seed_initial_credits();
