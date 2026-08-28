-- 071_durable_generation_rpc_grants.sql
-- Workflow control RPCs are server-only. RLS remains deny-by-default.

revoke execute on function public.krakatoa_settle_generation_stop(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.krakatoa_mark_workflow_provider_committed(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.krakatoa_request_generation_stop(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.krakatoa_reserve_provider_submission(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.krakatoa_claim_provider_submission(uuid, uuid)
  from public, anon, authenticated;
revoke execute on function public.krakatoa_mark_provider_submission_submitted(uuid, uuid, text)
  from public, anon, authenticated;
revoke execute on function public.krakatoa_complete_provider_submission(uuid, uuid, text, text, jsonb)
  from public, anon, authenticated;
revoke execute on function public.krakatoa_finalize_workflow_generation_success(
  uuid, uuid, uuid, uuid, text, uuid, text, jsonb, integer, jsonb, text, text, text, jsonb
) from public, anon, authenticated;
revoke execute on function public.krakatoa_complete_workflow_provider_success(
  uuid, uuid, uuid, uuid, text
) from public, anon, authenticated;
revoke execute on function public.krakatoa_mark_provider_submission_unknown_timeout(
  uuid, uuid, uuid, uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.krakatoa_settle_generation_stop(uuid, uuid)
  to service_role;
grant execute on function public.krakatoa_mark_workflow_provider_committed(uuid, uuid, uuid)
  to service_role;
grant execute on function public.krakatoa_request_generation_stop(uuid, uuid, uuid)
  to service_role;
grant execute on function public.krakatoa_reserve_provider_submission(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.krakatoa_claim_provider_submission(uuid, uuid)
  to service_role;
grant execute on function public.krakatoa_mark_provider_submission_submitted(uuid, uuid, text)
  to service_role;
grant execute on function public.krakatoa_complete_provider_submission(uuid, uuid, text, text, jsonb)
  to service_role;
grant execute on function public.krakatoa_finalize_workflow_generation_success(
  uuid, uuid, uuid, uuid, text, uuid, text, jsonb, integer, jsonb, text, text, text, jsonb
) to service_role;
grant execute on function public.krakatoa_complete_workflow_provider_success(
  uuid, uuid, uuid, uuid, text
) to service_role;
grant execute on function public.krakatoa_mark_provider_submission_unknown_timeout(
  uuid, uuid, uuid, uuid, jsonb
) to service_role;
