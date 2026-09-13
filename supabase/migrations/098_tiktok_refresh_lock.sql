-- Serialize TikTok refresh → persist per (user_id, platform).
-- TikTok invalidates the old refresh_token on every refreshAccessToken call.
-- Concurrent GET /api/connections/tiktok/creator-info and GET /api/cron must
-- not both refresh the same row: the loser would persist a dead token.
--
-- PostgREST cannot hold a session advisory lock across the TikTok HTTP call,
-- so the claim RPC takes FOR UPDATE and writes a short lease. The winner
-- refreshes, then complete persists the rotated tokens and clears the lease.
-- Generic (user_id, platform) helper — callers use it for TikTok only.
--
-- Service-role only. Idempotent. Safe to re-run.

alter table public.platform_tokens
  add column if not exists refresh_lock_until timestamptz;

comment on column public.platform_tokens.refresh_lock_until is
  'Short lease for the refresh+persist critical section. Null when idle.';

create or replace function public.krakatoa_claim_platform_token_refresh(
  p_user_id uuid,
  p_platform text,
  p_lock_seconds integer default 45
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.platform_tokens;
  v_now timestamptz := clock_timestamp();
  v_secs integer;
begin
  if p_user_id is null or p_platform is null or btrim(p_platform) = '' then
    raise exception 'CLAIM_REQUIRED';
  end if;

  v_secs := greatest(coalesce(p_lock_seconds, 45), 1);

  select * into v_row
  from public.platform_tokens
  where user_id = p_user_id
    and platform = p_platform
  for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'missing');
  end if;

  if v_row.refresh_lock_until is not null and v_row.refresh_lock_until > v_now then
    return jsonb_build_object(
      'claimed', false,
      'reason', 'held',
      'access_token', v_row.access_token,
      'refresh_token', v_row.refresh_token,
      'expires_at', v_row.expires_at
    );
  end if;

  update public.platform_tokens
  set refresh_lock_until = v_now + make_interval(secs => v_secs)
  where user_id = p_user_id
    and platform = p_platform;

  return jsonb_build_object(
    'claimed', true,
    'access_token', v_row.access_token,
    'refresh_token', v_row.refresh_token,
    'expires_at', v_row.expires_at
  );
end;
$$;

revoke all on function public.krakatoa_claim_platform_token_refresh(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.krakatoa_claim_platform_token_refresh(uuid, text, integer)
  to service_role;

create or replace function public.krakatoa_complete_platform_token_refresh(
  p_user_id uuid,
  p_platform text,
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_user_id is null or p_platform is null or btrim(p_platform) = ''
     or p_access_token is null or btrim(p_access_token) = ''
     or p_refresh_token is null or btrim(p_refresh_token) = ''
     or p_expires_at is null then
    raise exception 'COMPLETE_REQUIRED';
  end if;

  perform 1
  from public.platform_tokens
  where user_id = p_user_id
    and platform = p_platform
  for update;

  update public.platform_tokens
  set
    access_token = p_access_token,
    refresh_token = p_refresh_token,
    expires_at = p_expires_at,
    refresh_lock_until = null
  where user_id = p_user_id
    and platform = p_platform;

  get diagnostics v_count = row_count;
  if v_count = 0 then
    raise exception 'TOKEN_ROW_MISSING';
  end if;

  return jsonb_build_object('persisted', true);
end;
$$;

revoke all on function public.krakatoa_complete_platform_token_refresh(uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.krakatoa_complete_platform_token_refresh(uuid, text, text, text, timestamptz)
  to service_role;

create or replace function public.krakatoa_release_platform_token_refresh(
  p_user_id uuid,
  p_platform text
)
returns jsonb
language plpgsql
set search_path = ''
as $$
begin
  if p_user_id is null or p_platform is null or btrim(p_platform) = '' then
    raise exception 'RELEASE_REQUIRED';
  end if;

  update public.platform_tokens
  set refresh_lock_until = null
  where user_id = p_user_id
    and platform = p_platform;

  return jsonb_build_object('released', true);
end;
$$;

revoke all on function public.krakatoa_release_platform_token_refresh(uuid, text)
  from public, anon, authenticated;
grant execute on function public.krakatoa_release_platform_token_refresh(uuid, text)
  to service_role;
