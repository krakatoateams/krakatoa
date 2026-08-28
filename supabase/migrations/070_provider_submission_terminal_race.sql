-- 070_provider_submission_terminal_race.sql
-- A timeout may not overwrite a webhook terminal state observed concurrently.
-- Idempotent: safe to re-run. Deny-by-default RLS unchanged.

create or replace function public.krakatoa_complete_provider_submission(
  p_profile_id uuid,
  p_submission_id uuid,
  p_prediction_id text,
  p_terminal_state text,
  p_error_json jsonb default null
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_row public.generation_provider_submissions;
  v_prediction_id text;
begin
  if p_terminal_state not in ('completed', 'failed', 'timed_out') then
    raise exception 'INVALID_SUBMISSION_TERMINAL_STATE';
  end if;

  v_prediction_id := nullif(btrim(coalesce(p_prediction_id, '')), '');

  select * into v_row
  from public.generation_provider_submissions
  where id = p_submission_id
    and profile_id = p_profile_id
  for update;

  if not found then
    return false;
  end if;

  if v_row.state in ('completed', 'failed', 'timed_out') then
    if v_row.state is distinct from p_terminal_state then
      return false;
    end if;
    if v_prediction_id is null then
      return true;
    end if;
    return v_row.prediction_id is null or v_row.prediction_id = v_prediction_id;
  end if;

  update public.generation_provider_submissions
  set
    state = p_terminal_state,
    prediction_id = coalesce(v_row.prediction_id, v_prediction_id),
    error_json = coalesce(p_error_json, error_json),
    completed_at = now(),
    submitted_at = coalesce(submitted_at, now())
  where id = p_submission_id
    and profile_id = p_profile_id;

  return true;
end;
$$;

-- Persist a factual provider success and the no-refund marker atomically. A
-- concurrent Stop either settles first or observes this commit; there is no
-- database-visible gap between the fence and refund policy.
create or replace function public.krakatoa_complete_workflow_provider_success(
  p_profile_id uuid,
  p_job_id uuid,
  p_generation_request_id uuid,
  p_submission_id uuid,
  p_prediction_id text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_req public.generation_requests;
  v_submission public.generation_provider_submissions;
  v_prediction_id text;
begin
  v_prediction_id := nullif(btrim(coalesce(p_prediction_id, '')), '');
  if v_prediction_id is null then
    return jsonb_build_object('committed', false, 'reason', 'prediction_id_required');
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
    and profile_id = p_profile_id
  for update;

  if not found or coalesce(v_job.execution_backend, 'legacy') <> 'workflow' then
    return jsonb_build_object('committed', false, 'reason', 'job_not_active');
  end if;

  select * into v_req
  from public.generation_requests
  where id = p_generation_request_id
    and profile_id = p_profile_id
    and job_id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'request_not_found');
  end if;

  select * into v_submission
  from public.generation_provider_submissions
  where id = p_submission_id
    and profile_id = p_profile_id
    and generation_request_id = p_generation_request_id
    and job_id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'submission_not_found');
  end if;

  if v_submission.prediction_id is not null
    and v_submission.prediction_id <> v_prediction_id then
    return jsonb_build_object('committed', false, 'reason', 'prediction_id_conflict');
  end if;

  update public.generation_provider_submissions
  set
    state = 'completed',
    prediction_id = coalesce(prediction_id, v_prediction_id),
    submitted_at = coalesce(submitted_at, now()),
    completed_at = coalesce(completed_at, now()),
    error_json = null
  where id = p_submission_id
    and profile_id = p_profile_id;

  update public.generation_requests
  set
    provider_committed_at = coalesce(provider_committed_at, now()),
    cancel_allowed = false
  where id = p_generation_request_id
    and profile_id = p_profile_id;

  return jsonb_build_object(
    'committed', true,
    'shouldContinue',
      v_job.status not in ('succeeded', 'failed', 'cancelled')
      and not coalesce(v_req.cancel_requested, false)
  );
end;
$$;

-- Resolve the ambiguous-submit timeout against Stop and a concurrent webhook in
-- one lock order: job -> request -> submission.
create or replace function public.krakatoa_mark_provider_submission_unknown_timeout(
  p_profile_id uuid,
  p_job_id uuid,
  p_generation_request_id uuid,
  p_submission_id uuid,
  p_error_json jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_req public.generation_requests;
  v_submission public.generation_provider_submissions;
begin
  select * into v_job
  from public.jobs
  where id = p_job_id
    and profile_id = p_profile_id
  for update;

  if not found or v_job.status in ('succeeded', 'failed', 'cancelled') then
    return jsonb_build_object('action', 'stop_won');
  end if;

  select * into v_req
  from public.generation_requests
  where id = p_generation_request_id
    and profile_id = p_profile_id
    and job_id = p_job_id
  for update;

  if not found or coalesce(v_req.cancel_requested, false) then
    return jsonb_build_object('action', 'stop_won');
  end if;

  select * into v_submission
  from public.generation_provider_submissions
  where id = p_submission_id
    and profile_id = p_profile_id
    and generation_request_id = p_generation_request_id
    and job_id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('action', 'missing');
  end if;

  if v_submission.state in ('completed', 'failed', 'timed_out') then
    return jsonb_build_object(
      'action', 'concurrent_terminal',
      'state', v_submission.state,
      'predictionId', v_submission.prediction_id,
      'errorJson', v_submission.error_json
    );
  end if;

  update public.generation_requests
  set
    provider_committed_at = coalesce(provider_committed_at, now()),
    cancel_allowed = false
  where id = p_generation_request_id
    and profile_id = p_profile_id;

  update public.generation_provider_submissions
  set
    state = 'timed_out',
    error_json = coalesce(p_error_json, error_json),
    completed_at = now()
  where id = p_submission_id
    and profile_id = p_profile_id;

  return jsonb_build_object('action', 'timed_out');
end;
$$;
