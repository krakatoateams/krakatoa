-- 057_admin_monitoring_indexes.sql
-- Read-path indexes for the admin monitoring panel (/admin/monitoring).
--
-- No new tables and no new columns: the panel is a join over data that already
-- exists (jobs, job_steps, credit_transactions, generation_requests,
-- generation_predictions). These two indexes cover the only cross-tenant queries
-- that previously had no supporting index.
--
-- Additive and idempotent; safe to re-run via `npm run db:setup`.

-- Cross-user "which steps are failing" feed. job_steps_stepkey_status_idx exists
-- but carries no time column, so a windowed failure scan would seq-scan.
create index if not exists job_steps_status_created_idx
  on public.job_steps (status, created_at desc);

-- Cancels awaiting acknowledgement. Partial, so it stays tiny: the vast majority
-- of generation_requests rows never have cancel_requested set.
create index if not exists generation_requests_cancel_pending_idx
  on public.generation_requests (updated_at desc)
  where cancel_requested;

-- Already present, listed here so the panel's query plan is documented in one place:
--   jobs_status_created_idx     (007) — active + windowed job list
--   jobs_status_updated_idx     (054) — stuck-job detection
--   credit_tx_job_idx           (004) — spend/refund per job
--   job_steps_job_created_idx   (003) — step timeline per job
--   generation_requests_job_idx (008) — cancel flags per job
