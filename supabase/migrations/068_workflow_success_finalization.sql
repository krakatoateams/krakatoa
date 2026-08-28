-- 068_workflow_success_finalization.sql
-- Atomic workflow-era success finalization (job + request + asset + creation).
-- Idempotent: safe to re-run. Deny-by-default RLS unchanged.

create or replace function public.krakatoa_finalize_workflow_generation_success(
  p_profile_id uuid,
  p_job_id uuid,
  p_generation_request_id uuid,
  p_user_id uuid,
  p_storage_path text,
  p_asset_id uuid,
  p_video_url text,
  p_job_output jsonb,
  p_cost_credits int,
  p_asset_metadata jsonb,
  p_creation_tool text,
  p_creation_tool_label text,
  p_creation_title text,
  p_creation_metadata jsonb
) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_job public.jobs;
  v_req public.generation_requests;
  v_profile public.profiles;
  v_creation public.user_creations;
  v_response jsonb;
begin
  if p_storage_path is null or btrim(p_storage_path) = '' then
    return jsonb_build_object('action', 'invalid', 'reason', 'storage_path_required');
  end if;

  if p_cost_credits is null or p_cost_credits < 0 then
    return jsonb_build_object('action', 'invalid', 'reason', 'invalid_cost_credits');
  end if;

  select * into v_profile
  from public.profiles
  where id = p_profile_id;

  if not found then
    return jsonb_build_object('action', 'invalid', 'reason', 'profile_not_found');
  end if;

  if v_profile.user_id is distinct from p_user_id then
    return jsonb_build_object('action', 'invalid', 'reason', 'profile_user_mismatch');
  end if;

  select * into v_job
  from public.jobs
  where id = p_job_id
    and profile_id = p_profile_id
  for update;

  if not found then
    return jsonb_build_object('action', 'invalid', 'reason', 'job_not_found');
  end if;

  if coalesce(v_job.execution_backend, 'legacy') <> 'workflow' then
    return jsonb_build_object('action', 'invalid', 'reason', 'not_workflow_backend');
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

  if v_req.status = 'succeeded' then
    return jsonb_build_object('action', 'noop_already', 'replay', true);
  end if;

  if v_job.status in ('succeeded', 'failed', 'cancelled') then
    return jsonb_build_object('action', 'noop_already', 'replay', true);
  end if;

  if coalesce(v_req.cancel_requested, false) then
    return jsonb_build_object('action', 'stop_won', 'storagePath', p_storage_path);
  end if;

  if v_req.provider_committed_at is null then
    return jsonb_build_object('action', 'invalid', 'reason', 'provider_not_committed');
  end if;

  insert into public.user_creations (
    user_id,
    tool,
    media_type,
    media_url,
    storage_path,
    title,
    metadata
  ) values (
    p_user_id,
    p_creation_tool,
    'video',
    p_storage_path,
    p_storage_path,
    coalesce(p_creation_title, ''),
    coalesce(p_creation_metadata, '{}'::jsonb)
  )
  on conflict (user_id, storage_path)
  where storage_path <> ''
  do update set
    media_url = excluded.media_url,
    title = excluded.title,
    metadata = excluded.metadata
  returning * into v_creation;

  v_response := jsonb_build_object(
    'videoUrl', p_video_url,
    'storagePath', p_storage_path,
    'savedToCloud', true,
    'historyItem', jsonb_build_object(
      'id', v_creation.id,
      'tool', v_creation.tool,
      'toolLabel', coalesce(p_creation_tool_label, p_creation_tool),
      'mediaType', 'video',
      'mediaUrl', p_storage_path,
      'storagePath', v_creation.storage_path,
      'title', v_creation.title,
      'createdAt', v_creation.created_at,
      'metadata', coalesce(v_creation.metadata, '{}'::jsonb)
    )
  );

  if p_asset_id is not null then
    update public.assets
    set
      status = 'ready',
      storage_path = p_storage_path,
      mime_type = 'video/mp4',
      duration_sec = coalesce((p_asset_metadata->>'billedDuration')::numeric, duration_sec),
      cost_credits = p_cost_credits,
      metadata = coalesce(p_asset_metadata, metadata)
    where id = p_asset_id
      and profile_id = p_profile_id
      and job_id = p_job_id;
  end if;

  update public.jobs
  set
    status = 'succeeded',
    finished_at = coalesce(finished_at, now()),
    cost_credits = p_cost_credits,
    output = coalesce(p_job_output, output)
  where id = p_job_id
    and profile_id = p_profile_id;

  update public.generation_requests
  set
    status = 'succeeded',
    response_json = v_response,
    error_json = null,
    locked_until = null,
    asset_id = coalesce(p_asset_id, asset_id)
  where id = p_generation_request_id
    and profile_id = p_profile_id;

  return jsonb_build_object(
    'action', 'finalized',
    'creationId', v_creation.id,
    'storagePath', p_storage_path,
    'responseJson', v_response
  );
end;
$$;
