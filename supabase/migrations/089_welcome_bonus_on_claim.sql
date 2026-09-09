-- 089_welcome_bonus_on_claim.sql
-- Stop auto-granting the welcome bonus at signup — the product moved to an
-- on-demand "claim your free video" flow (see the welcome-video-offer
-- change): new regular users now start at 0 credits, and POST
-- /api/welcome-video-offer/claim grants welcome_bonus_settings.credit_amount
-- the moment they actually click Claim, via the same krakatoa_apply_credit_
-- transaction RPC (idempotency key 'bonus:welcome_video_claim:{profileId}',
-- distinct from this trigger's old 'seed:welcome_bonus:{id}' key so the two
-- can never collide even if this trigger is ever re-enabled by mistake).
--
-- welcome_bonus_settings (table + admin UI) is unchanged and kept as the
-- single source of truth for whether the offer is on and its amount — it's
-- just read by the app's claim endpoint now instead of by this trigger.
--
-- Admins still get their 500 dummy-credit seed on insert (unchanged).
--
-- Additive-in-spirit (only redefines a function), idempotent, safe to re-run.

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
  -- Active admins/owners (case-insensitive email match against admin_users).
  select exists (
    select 1
    from public.admin_users a
    where a.status = 'active'
      and lower(a.email) = lower(coalesce(new.email, ''))
  )
  into v_is_admin;

  if not v_is_admin then
    -- Regular users start at 0 now — the welcome bonus is granted on-demand
    -- by POST /api/welcome-video-offer/claim, not automatically here.
    return new;
  end if;

  -- New-user bonus expiry (kept for the admin seed grant below).
  select new_user_bonus_credit_days into v_days
  from public.expiry_settings
  where key = 'global';

  if v_days is not null and v_days > 0 then
    v_expires_at := now() + make_interval(days => v_days);
  else
    v_expires_at := null;
  end if;

  -- Internal testing seed: active admins always receive 500 dummy credits.
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

-- Re-assert the trigger idempotently (unchanged wiring from 006/024/051/053).
drop trigger if exists profiles_seed_initial_credits on public.profiles;
create trigger profiles_seed_initial_credits
  after insert on public.profiles
  for each row execute function public.krakatoa_seed_initial_credits();
