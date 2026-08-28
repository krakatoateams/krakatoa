-- 075_generation_request_takeover_predictions.sql
-- Also clear old prediction tracking when a failed request starts a new attempt.

create or replace function public.krakatoa_take_over_generation_request(
  p_profile_id uuid,
  p_request_id uuid,
  p_expected_updated_at timestamptz,
  p_request_hash text,
  p_route_key text,
  p_tool_key text,
  p_locked_until timestamptz
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_req public.generation_requests;
  v_job_status text;
begin
  select * into v_req
  from public.generation_requests
  where id = p_request_id and profile_id = p_profile_id
  for update;

  if not found then
    return jsonb_build_object('action', 'missing');
  end if;

  if v_req.updated_at is distinct from p_expected_updated_at then
    return jsonb_build_object('action', 'race_lost');
  end if;

  if v_req.job_id is not null then
    select status into v_job_status
    from public.jobs
    where id = v_req.job_id and profile_id = p_profile_id;

    if v_job_status in ('queued', 'running', 'recoverable', 'succeeded') then
      return jsonb_build_object('action', 'blocked', 'jobStatus', v_job_status);
    end if;
  end if;

  delete from public.generation_predictions
  where generation_request_id = p_request_id and profile_id = p_profile_id;

  delete from public.generation_provider_submissions
  where generation_request_id = p_request_id and profile_id = p_profile_id;

  update public.generation_requests
  set status = 'started',
      request_hash = p_request_hash,
      route_key = p_route_key,
      tool_key = p_tool_key,
      locked_until = p_locked_until,
      error_json = null,
      response_json = null,
      job_id = null,
      asset_id = null,
      cancel_requested = false,
      cancel_allowed = true,
      provider_committed_at = null
  where id = p_request_id and profile_id = p_profile_id;

  return jsonb_build_object('action', 'proceed', 'id', p_request_id);
end;
$$;
