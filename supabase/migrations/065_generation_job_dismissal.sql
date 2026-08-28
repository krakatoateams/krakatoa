-- 065_generation_job_dismissal.sql
-- Soft-dismiss failed/cancelled jobs from active-generation tiles.
-- Idempotent: safe to re-run. Deny-by-default RLS unchanged.

alter table jobs
  add column if not exists dismissed_at timestamptz;

-- Active-generation queries filter dismissed_at is null.
create index if not exists jobs_active_not_dismissed_idx
  on jobs (profile_id, updated_at desc)
  where dismissed_at is null
    and status in ('queued', 'running', 'recoverable', 'failed', 'cancelled');
