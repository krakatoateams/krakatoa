-- 069_durable_generation_control_hardening.sql
-- Harden workflow-era stop control: fail running job_steps on settlement and add
-- atomic request-stop RPC. Idempotent: safe to re-run. Deny-by-default RLS unchanged.

-- ---------------------------------------------------------------------------
-- krakatoa_settle_generation_stop
-- Locks profile-scoped job + latest linked generation_request, decides refund
-- eligibility atomically, refunds via ledger RPC when eligible, fails running
-- job_steps, then closes assets/requests/job. Terminal replay returns existing
-- state — never double-refunds.
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_settle_generation_stop(
  p_profile_id uuid,
  p_job_id uuid
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
  v_err jsonb;
  v_action text;
begin
  select * into v_job
  from public.jobs
  where id = p_job_id
    and profile_id = p_profile_id
  for update;

  if not found then
    raise exception 'JOB_NOT_FOUND: job not found for profile';
  end if;

  v_refund_key := 'refund:' || v_job.job_type || ':' || p_job_id::text;

  if v_job.status in ('succeeded', 'failed', 'cancelled') then
    select exists (
      select 1
      from public.credit_transactions
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
  where profile_id = p_profile_id
    and job_id = p_job_id
  order by created_at desc
  limit 1
  for update;

  -- Fail closed when no request is linked: without its commit marker we cannot
  -- prove that a provider charge has not already happened.
  v_refund_eligible := (
    v_req.id is not null
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
        'Refund after user stop',
        jsonb_build_object('reason', 'generation_cancelled', 'settlement', 'workflow_stop'),
        v_refund_key,
        p_job_id,
        null,
        'refund',
        null
      );

      v_refunded := coalesce(v_refund_result->'transaction'->>'status', '') = 'succeeded';
    end if;
  end if;

  if v_refund_eligible then
    v_err := jsonb_build_object(
      'code', 'GENERATION_CANCELLED',
      'message', 'Generation stopped by user.'
    );
    v_action := case when v_refunded then 'settled' else 'settled_no_refund' end;
  else
    v_err := jsonb_build_object(
      'code', 'GENERATION_CANCELLED',
      'message', 'Generation stopped by user. Credits were not refunded because provider output was already committed.'
    );
    v_action := 'settled_no_refund';
  end if;

  update public.assets
  set
    status = 'failed',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('error', v_err)
  where profile_id = p_profile_id
    and job_id = p_job_id
    and status = 'processing';

  update public.job_steps
  set
    status = 'failed',
    error = v_err,
    finished_at = coalesce(finished_at, now())
  where profile_id = p_profile_id
    and job_id = p_job_id
    and status = 'running';

  update public.generation_requests
  set
    status = 'failed',
    error_json = v_err,
    locked_until = null
  where profile_id = p_profile_id
    and job_id = p_job_id
    and status <> 'succeeded';

  update public.jobs
  set
    status = 'cancelled',
    error = v_err,
    finished_at = coalesce(finished_at, now())
  where id = p_job_id
    and profile_id = p_profile_id;

  return jsonb_build_object(
    'action', v_action,
    'refunded', v_refunded,
    'refundEligible', v_refund_eligible,
    'replay', false
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- krakatoa_request_generation_stop
-- Atomically requests workflow-era stop: locks profile-owned job then the exact
-- generation_request row, rejects terminal/missing rows, derives refundEligible
-- from provider_committed_at + cancel_allowed, sets cancel_requested true.
-- Idempotent when stop was already requested.
-- ---------------------------------------------------------------------------
create or replace function public.krakatoa_request_generation_stop(
  p_profile_id uuid,
  p_job_id uuid,
  p_generation_request_id uuid
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_req public.generation_requests;
  v_refund_eligible boolean := false;
  v_already_requested boolean := false;
begin
  select * into v_job
  from public.jobs
  where id = p_job_id
    and profile_id = p_profile_id
  for update;

  if not found then
    return jsonb_build_object(
      'accepted', false,
      'refundEligible', false,
      'alreadyRequested', false,
      'reason', 'job_not_found'
    );
  end if;

  if v_job.status in ('succeeded', 'failed', 'cancelled') then
    return jsonb_build_object(
      'accepted', false,
      'refundEligible', false,
      'alreadyRequested', false,
      'status', v_job.status
    );
  end if;

  select * into v_req
  from public.generation_requests
  where id = p_generation_request_id
    and profile_id = p_profile_id
    and job_id = p_job_id
  for update;

  if not found then
    return jsonb_build_object(
      'accepted', false,
      'refundEligible', false,
      'alreadyRequested', false,
      'reason', 'request_not_found'
    );
  end if;

  if v_req.status in ('succeeded', 'failed') then
    return jsonb_build_object(
      'accepted', false,
      'refundEligible', false,
      'alreadyRequested', false,
      'status', v_req.status
    );
  end if;

  v_refund_eligible := (
    v_req.provider_committed_at is null
    and coalesce(v_req.cancel_allowed, true)
  );

  v_already_requested := coalesce(v_req.cancel_requested, false);

  if not v_already_requested then
    update public.generation_requests
    set cancel_requested = true
    where id = p_generation_request_id
      and profile_id = p_profile_id;
  end if;

  return jsonb_build_object(
    'accepted', true,
    'refundEligible', v_refund_eligible,
    'alreadyRequested', v_already_requested
  );
end;
$$;
