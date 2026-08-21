-- 064_durable_generation_workflows.sql
-- Phase 1 foundation: execution backend metadata for durable Vercel Workflow runs.
-- Idempotent: safe to re-run. Deny-by-default RLS unchanged.

alter table jobs
  add column if not exists execution_backend text not null default 'legacy';

alter table jobs
  add column if not exists workflow_run_id text;

alter table jobs
  add column if not exists heartbeat_at timestamptz;

alter table generation_requests
  add column if not exists provider_committed_at timestamptz;

do $$
begin
  alter table jobs drop constraint if exists jobs_execution_backend_check;
exception
  when undefined_object then null;
end $$;

alter table jobs
  add constraint jobs_execution_backend_check
  check (execution_backend in ('legacy', 'workflow'));

-- Lookup workflow run id → job during status/reconcile.
create index if not exists jobs_workflow_run_id_idx
  on jobs (workflow_run_id)
  where workflow_run_id is not null;

-- Stale-heartbeat sweep for active workflow-era jobs only.
create index if not exists jobs_workflow_active_heartbeat_idx
  on jobs (heartbeat_at)
  where execution_backend = 'workflow'
    and status in ('queued', 'running', 'recoverable');
