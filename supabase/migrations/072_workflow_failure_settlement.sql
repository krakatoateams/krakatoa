-- 072_workflow_failure_settlement.sql
-- Atomically fail workflow jobs without refunding after provider commit, and
-- reject late provider success for failed/cancelled jobs.

create or replace function public.krakatoa_fail_workflow_generation(
  p_profile_id uuid,
  p_job_id uuid,
  p_generation_request_id uuid,
  p_error_json jsonb,
  p_refund_requested boolean default true
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_req public.generation_requests;
  v_spend_amount int := 0;
  v_refund_eligible boolean := false;
  v_refunded boolean := false;
  v_refund_key text;
  v_refund_result jsonb;
  v_error jsonb := coalesce(
    p_error_json,
    jsonb_build_object('code', 'GENERATION_FAILED', 'message', 'Generation failed.')
  );
begin
  select * into v_job
  from public.jobs
  where id = p_job_id and profile_id = p_profile_id
  for update;

  if not found or coalesce(v_job.execution_backend, 'legacy') <> 'workflow' then
    return jsonb_build_object('action', 'invalid', 'reason', 'job_not_found');
  end if;

  v_refund_key := 'refund:' || v_job.job_type || ':' || p_job_id::text;

  if v_job.status in ('succeeded', 'failed', 'cancelled') then
    select exists (
      select 1 from public.credit_transactions
      where profile_id = p_profile_id
        and job_id = p_job_id
        and type = 'refund'
        and status = 'succeeded'
        and idempotency_key = v_refund_key
    ) into v_refunded;
    return jsonb_build_object(
      'action', 'noop_terminal',
      'refunded', v_refunded,
      'refundEligible', false,
      'replay', true
    );
  end if;

  select * into v_req
  from public.generation_requests
  where id = p_generation_request_id
    and profile_id = p_profile_id
    and job_id = p_job_id
  for update;

  if not found then
    return jsonb_build_object('action', 'invalid', 'reason', 'request_not_found');
  end if;

  if coalesce(v_req.cancel_requested, false) then
    return jsonb_build_object('action', 'stop_won');
  end if;

  v_refund_eligible := (
    coalesce(p_refund_requested, true)
    and v_req.provider_committed_at is null
    and coalesce(v_req.cancel_allowed, true)
  );

  if v_refund_eligible then
    select ct.amount into v_spend_amount
    from public.credit_transactions ct
    where ct.profile_id = p_profile_id
      and ct.job_id = p_job_id
      and ct.type = 'spend'
      and ct.status = 'succeeded'
    order by ct.created_at desc
    limit 1;
    v_spend_amount := coalesce(v_spend_amount, 0);

    if v_spend_amount > 0 then
      v_refund_result := public.krakatoa_apply_credit_transaction(
        p_profile_id,
        v_spend_amount,
        'credit',
        'refund',
        'succeeded',
        'Refund after workflow generation failure',
        jsonb_build_object('reason', 'generation_failed', 'settlement', 'workflow_failure'),
        v_refund_key,
        p_job_id,
        null,
        'refund',
        null
      );
      v_refunded := coalesce(v_refund_result->'transaction'->>'status', '') = 'succeeded';
    end if;
  end if;

  update public.assets
  set status = 'failed',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('error', v_error)
  where profile_id = p_profile_id and job_id = p_job_id and status = 'processing';

  update public.job_steps
  set status = 'failed',
      error = v_error,
      finished_at = coalesce(finished_at, now())
  where profile_id = p_profile_id and job_id = p_job_id and status = 'running';

  update public.generation_requests
  set status = 'failed',
      error_json = v_error,
      locked_until = null
  where id = p_generation_request_id and profile_id = p_profile_id;

  update public.jobs
  set status = 'failed',
      error = v_error,
      finished_at = coalesce(finished_at, now())
  where id = p_job_id and profile_id = p_profile_id;

  return jsonb_build_object(
    'action', 'failed',
    'refunded', v_refunded,
    'refundEligible', v_refund_eligible,
    'replay', false
  );
end;
$$;

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
  where id = p_job_id and profile_id = p_profile_id
  for update;

  if not found or coalesce(v_job.execution_backend, 'legacy') <> 'workflow' then
    return jsonb_build_object('committed', false, 'reason', 'job_not_found');
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

  if v_job.status = 'succeeded'
    and v_req.status = 'succeeded'
    and v_submission.state = 'completed'
    and v_req.provider_committed_at is not null then
    return jsonb_build_object(
      'committed', true,
      'shouldContinue', false,
      'replay', true
    );
  end if;

  if v_job.status in ('succeeded', 'failed', 'cancelled')
    or v_req.status in ('succeeded', 'failed') then
    return jsonb_build_object('committed', false, 'reason', 'job_terminal');
  end if;

  update public.generation_provider_submissions
  set state = 'completed',
      prediction_id = coalesce(prediction_id, v_prediction_id),
      submitted_at = coalesce(submitted_at, now()),
      completed_at = coalesce(completed_at, now()),
      error_json = null
  where id = p_submission_id and profile_id = p_profile_id;

  update public.generation_requests
  set provider_committed_at = coalesce(provider_committed_at, now()),
      cancel_allowed = false
  where id = p_generation_request_id and profile_id = p_profile_id;

  return jsonb_build_object(
    'committed', true,
    'shouldContinue', not coalesce(v_req.cancel_requested, false),
    'replay', false
  );
end;
$$;

revoke execute on function public.krakatoa_fail_workflow_generation(
  uuid, uuid, uuid, jsonb, boolean
) from public, anon, authenticated;
grant execute on function public.krakatoa_fail_workflow_generation(
  uuid, uuid, uuid, jsonb, boolean
) to service_role;
