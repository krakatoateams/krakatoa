-- 073_provider_failure_prediction_binding.sql
-- A terminal failure/cancel callback cannot overwrite a submission that is
-- already bound to a different Replicate prediction.

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
  where id = p_submission_id and profile_id = p_profile_id
  for update;

  if not found then
    return false;
  end if;

  if v_row.prediction_id is not null
    and v_prediction_id is not null
    and v_row.prediction_id <> v_prediction_id then
    return false;
  end if;

  if v_row.state in ('completed', 'failed', 'timed_out') then
    return v_row.state = p_terminal_state;
  end if;

  update public.generation_provider_submissions
  set state = p_terminal_state,
      prediction_id = coalesce(v_row.prediction_id, v_prediction_id),
      error_json = coalesce(p_error_json, error_json),
      completed_at = now(),
      submitted_at = coalesce(submitted_at, now())
  where id = p_submission_id and profile_id = p_profile_id;

  return true;
end;
$$;
