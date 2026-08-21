-- 067_provider_submission_fence.sql
-- At-most-one Replicate submission per (generation_request, slot_key).
-- Idempotent: safe to re-run. Deny-by-default RLS unchanged.

create table if not exists generation_provider_submissions (
  id uuid primary key default gen_random_uuid(),
  generation_request_id uuid not null references generation_requests (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  job_id uuid references jobs (id) on delete set null,
  slot_key text not null,
  state text not null default 'reserved'
    check (state in ('reserved', 'submitting', 'submitted', 'completed', 'failed', 'timed_out')),
  prediction_id text,
  error_json jsonb,
  reserved_at timestamptz not null default now(),
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (generation_request_id, slot_key)
);

create index if not exists generation_provider_submissions_request_idx
  on generation_provider_submissions (generation_request_id);

create index if not exists generation_provider_submissions_prediction_idx
  on generation_provider_submissions (prediction_id)
  where prediction_id is not null;

drop trigger if exists generation_provider_submissions_set_updated_at on generation_provider_submissions;
create trigger generation_provider_submissions_set_updated_at
  before update on generation_provider_submissions
  for each row execute function public.krakatoa_set_updated_at();

alter table generation_provider_submissions enable row level security;

-- ---------------------------------------------------------------------------
-- krakatoa_reserve_provider_submission
-- Atomically reserves a slot or returns the existing row for replay decisions.
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_reserve_provider_submission(
  p_profile_id uuid,
  p_job_id uuid,
  p_generation_request_id uuid,
  p_slot_key text
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.generation_provider_submissions;
begin
  insert into public.generation_provider_submissions (
    generation_request_id,
    profile_id,
    job_id,
    slot_key,
    state
  ) values (
    p_generation_request_id,
    p_profile_id,
    p_job_id,
    p_slot_key,
    'reserved'
  )
  on conflict (generation_request_id, slot_key) do nothing
  returning * into v_row;

  if v_row.id is not null then
    return jsonb_build_object(
      'action', 'reserved',
      'submissionId', v_row.id,
      'state', v_row.state,
      'predictionId', v_row.prediction_id,
      'reservedAt', v_row.reserved_at,
      'submittedAt', v_row.submitted_at,
      'completedAt', v_row.completed_at,
      'errorJson', v_row.error_json
    );
  end if;

  select * into v_row
  from public.generation_provider_submissions
  where generation_request_id = p_generation_request_id
    and slot_key = p_slot_key
    and profile_id = p_profile_id
  for update;

  if not found then
    raise exception 'SUBMISSION_FENCE_MISSING: reservation row not found after conflict';
  end if;

  return jsonb_build_object(
    'action', 'existing',
    'submissionId', v_row.id,
    'state', v_row.state,
    'predictionId', v_row.prediction_id,
    'reservedAt', v_row.reserved_at,
    'submittedAt', v_row.submitted_at,
    'completedAt', v_row.completed_at,
    'errorJson', v_row.error_json
  );
end;
$$;

-- Atomically claim a reserved slot before calling Replicate (reserved -> submitting).
-- Replay while submitting returns claimed=false so the workflow waits instead of resubmitting.
create or replace function public.krakatoa_claim_provider_submission(
  p_profile_id uuid,
  p_submission_id uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_row public.generation_provider_submissions;
begin
  select * into v_row
  from public.generation_provider_submissions
  where id = p_submission_id
    and profile_id = p_profile_id
  for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'not_found');
  end if;

  if v_row.state = 'reserved' then
    update public.generation_provider_submissions
    set state = 'submitting'
    where id = p_submission_id
      and profile_id = p_profile_id;

    return jsonb_build_object(
      'claimed', true,
      'submissionId', v_row.id,
      'state', 'submitting',
      'predictionId', v_row.prediction_id
    );
  end if;

  return jsonb_build_object(
    'claimed', false,
    'submissionId', v_row.id,
    'state', v_row.state,
    'predictionId', v_row.prediction_id,
    'reservedAt', v_row.reserved_at,
    'submittedAt', v_row.submitted_at,
    'completedAt', v_row.completed_at,
    'errorJson', v_row.error_json
  );
end;
$$;

-- Mark a claimed slot as submitted once Replicate accepts the prediction.
create or replace function public.krakatoa_mark_provider_submission_submitted(
  p_profile_id uuid,
  p_submission_id uuid,
  p_prediction_id text
) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_row public.generation_provider_submissions;
begin
  select * into v_row
  from public.generation_provider_submissions
  where id = p_submission_id
    and profile_id = p_profile_id
  for update;

  if not found then
    return false;
  end if;

  if v_row.state in ('completed', 'failed', 'timed_out') then
    return v_row.prediction_id = p_prediction_id;
  end if;

  if v_row.state not in ('submitting', 'submitted', 'reserved') then
    return false;
  end if;

  update public.generation_provider_submissions
  set
    state = 'submitted',
    prediction_id = coalesce(prediction_id, p_prediction_id),
    submitted_at = coalesce(submitted_at, now())
  where id = p_submission_id
    and profile_id = p_profile_id;

  return true;
end;
$$;

-- Idempotent webhook / poll completion for a submission fence.
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
