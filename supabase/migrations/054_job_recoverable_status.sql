-- Add recoverable job status for pipeline recovery (hold credits until terminal).
-- Idempotent: safe to re-run.

do $$
begin
  alter table jobs drop constraint if exists jobs_status_check;
exception
  when undefined_object then null;
end $$;

alter table jobs
  add constraint jobs_status_check
  check (status in ('queued', 'running', 'recoverable', 'succeeded', 'failed', 'cancelled'));

create index if not exists jobs_status_updated_idx
  on jobs (status, updated_at desc);
