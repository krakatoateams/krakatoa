-- 023_generation_cancellation.sql
-- Krakatoa generation cancellation (Cancel-in-flight v1).
--
-- Lets a user cancel an in-flight generation so the underlying Replicate
-- prediction is actually stopped (not just the browser tab closed). The flow:
--   1. Every charged route already records a `generation_requests` row keyed by
--      the client's Idempotency-Key (migration 008). That row is the client's
--      handle for the attempt.
--   2. As each Replicate prediction is created, the route records its provider
--      prediction id in `generation_predictions` (this migration).
--   3. POST /api/generations/cancel { idempotencyKey } sets
--      generation_requests.cancel_requested = true and calls
--      replicate.predictions.cancel(id) for every recorded prediction.
--   4. The provider poll loop in the still-running generate request observes the
--      `canceled` status, the route marks the job 'cancelled' and refunds.
--
-- Additive and non-destructive (create/alter ... if not exists); safe to re-run
-- via `npm run db:setup`.
--
-- Security model (unchanged from 003/004/007/008): RLS enabled deny-by-default
-- with NO policies. Server routes use the service role (bypasses RLS) and enforce
-- profile_id ownership in application code. Non-service roles get zero rows.

create extension if not exists pgcrypto;

-- Project-specific updated_at trigger helper (re-declared idempotently so this
-- migration is safe to apply on its own). search_path pinned per the linter.
create or replace function public.krakatoa_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancel flag on the existing generation_requests row. The cancel endpoint
-- flips this true; the running generate route checks it between steps to abort
-- early (before a not-yet-created provider call). Reset to false on takeover so
-- a re-run of the same idempotency key is not born pre-cancelled.
-- ---------------------------------------------------------------------------
alter table generation_requests
  add column if not exists cancel_requested boolean not null default false;

-- ---------------------------------------------------------------------------
-- generation_predictions — one row per Replicate prediction created while
-- serving a generation_requests attempt. Keyed by generation_request_id (which
-- always exists, unlike the best-effort job row) so the cancel endpoint can find
-- and cancel every in-flight prediction for the attempt.
-- ---------------------------------------------------------------------------
create table if not exists generation_predictions (
  id uuid primary key default gen_random_uuid(),
  generation_request_id uuid not null references generation_requests (id) on delete cascade,
  job_id uuid references jobs (id) on delete set null,
  profile_id uuid not null references profiles (id) on delete cascade,
  prediction_id text not null,
  kind text,
  status text not null default 'starting',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (generation_request_id, prediction_id)
);

drop trigger if exists generation_predictions_set_updated_at on generation_predictions;
create trigger generation_predictions_set_updated_at
  before update on generation_predictions
  for each row execute function public.krakatoa_set_updated_at();

create index if not exists generation_predictions_request_idx
  on generation_predictions (generation_request_id);
create index if not exists generation_predictions_profile_idx
  on generation_predictions (profile_id);
create index if not exists generation_predictions_job_idx
  on generation_predictions (job_id);

-- ---------------------------------------------------------------------------
-- RLS — deny-by-default. Server routes use the service role (bypasses RLS) and
-- enforce profile_id ownership in app code. No anon/authenticated policies.
-- ---------------------------------------------------------------------------
alter table generation_predictions enable row level security;
