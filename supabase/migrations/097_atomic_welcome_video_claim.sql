-- Serialize welcome-video claim against first-job creation.
-- Eligibility (offer on, amount > 0, no jobs, no current/legacy grant) and
-- the ledger grant happen in one transaction under a profile row lock.
-- A BEFORE INSERT trigger on jobs takes the same lock so a concurrent first
-- job cannot commit between the claim's job check and grant.
--
-- Service-role only. Idempotent. Safe to re-run.

create or replace function public.krakatoa_lock_profile(p_profile_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform 1 from public.profiles where id = p_profile_id for update;
  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.krakatoa_lock_profile(uuid)
  from public, anon, authenticated;
grant execute on function public.krakatoa_lock_profile(uuid)
  to service_role;

create or replace function public.krakatoa_claim_welcome_video_offer(p_profile_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_enabled boolean;
  v_amount int;
  v_has_jobs boolean;
  v_has_claimed boolean;
  v_has_legacy boolean;
  v_days int;
  v_expires_at timestamptz;
  v_result jsonb;
  v_claim_key text;
  v_legacy_key text;
begin
  if p_profile_id is null then
    raise exception 'PROFILE_REQUIRED';
  end if;

  perform public.krakatoa_lock_profile(p_profile_id);

  v_claim_key := 'bonus:welcome_video_claim:' || p_profile_id::text;
  v_legacy_key := 'seed:welcome_bonus:' || p_profile_id::text;

  select enabled, credit_amount into v_enabled, v_amount
  from public.welcome_bonus_settings
  where key = 'global';

  -- Fail closed on missing/out-of-policy amounts (mirrors TS bound of 1_000_000).
  if v_amount is null or v_amount <= 0 or v_amount > 1000000 then
    v_amount := 0;
  end if;

  select exists (
    select 1 from public.jobs where profile_id = p_profile_id
  ) into v_has_jobs;

  select exists (
    select 1
    from public.credit_transactions
    where profile_id = p_profile_id
      and idempotency_key = v_claim_key
  ) into v_has_claimed;

  select exists (
    select 1
    from public.credit_transactions
    where profile_id = p_profile_id
      and idempotency_key = v_legacy_key
  ) into v_has_legacy;

  if not coalesce(v_enabled, false)
     or v_amount <= 0
     or v_has_jobs
     or v_has_claimed
     or v_has_legacy then
    return jsonb_build_object(
      'granted', false,
      'creditAmount', v_amount,
      'reason', 'ineligible'
    );
  end if;

  select new_user_bonus_credit_days into v_days
  from public.expiry_settings
  where key = 'global';

  if v_days is not null and v_days > 0 then
    v_expires_at := now() + make_interval(days => v_days);
  else
    v_expires_at := null;
  end if;

  v_result := public.krakatoa_apply_credit_transaction(
    p_profile_id      => p_profile_id,
    p_amount          => v_amount,
    p_direction       => 'credit',
    p_type            => 'bonus',
    p_status          => 'succeeded',
    p_description     => 'Welcome bonus — claimed',
    p_metadata        => jsonb_build_object('source', 'welcome_video_claim'),
    p_idempotency_key => v_claim_key,
    p_source          => 'new_user_bonus',
    p_expires_at      => v_expires_at
  );

  return jsonb_build_object(
    'granted', true,
    'creditAmount', v_amount,
    'replayed', coalesce((v_result ->> 'replayed')::boolean, false)
  );
end;
$$;

revoke all on function public.krakatoa_claim_welcome_video_offer(uuid)
  from public, anon, authenticated;
grant execute on function public.krakatoa_claim_welcome_video_offer(uuid)
  to service_role;

create or replace function public.krakatoa_jobs_lock_profile()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform public.krakatoa_lock_profile(new.profile_id);
  return new;
end;
$$;

revoke all on function public.krakatoa_jobs_lock_profile()
  from public, anon, authenticated;
grant execute on function public.krakatoa_jobs_lock_profile()
  to service_role;

drop trigger if exists jobs_lock_profile_before_insert on public.jobs;
create trigger jobs_lock_profile_before_insert
  before insert on public.jobs
  for each row execute function public.krakatoa_jobs_lock_profile();
