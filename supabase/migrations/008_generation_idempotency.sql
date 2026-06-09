-- 008_generation_idempotency.sql
-- Krakatoa generation request-level idempotency (Double-Charge Protection v1).
--
-- Adds a single table, generation_requests, that lets the five generation API
-- routes deduplicate work caused by double-submit, browser retry, network retry,
-- or accidental repeated POSTs. A client sends a per-submit `Idempotency-Key`
-- header; the route records a row BEFORE creating a job, spending credits, or
-- calling any provider. A duplicate key:
--   * that already succeeded  -> replays the stored response (no spend/provider)
--   * that is still running    -> returns "in progress" (no second job/spend)
--   * that failed / went stale -> may be taken over and retried
--   * with a different payload  -> is a conflict
--
-- Additive and non-destructive:
--   * create table if not exists / create index if not exists
--   * does NOT drop or alter existing tables/columns
--   * safe to re-run via `npm run db:setup`
--
-- Security model (unchanged from 003/004/007): RLS is enabled deny-by-default
-- with NO policies. Server routes use the Supabase service role (which bypasses
-- RLS) and enforce profile ownership in application code (every read/write is
-- scoped by profile_id). Non-service roles get zero rows.

-- gen_random_uuid() lives in pgcrypto on some Postgres setups; ensure available.
create extension if not exists pgcrypto;

-- Project-specific updated_at trigger helper. Already created by 003/004/007;
-- re-declared here (idempotent) so this migration is safe to apply on its own.
-- search_path is pinned to '' to satisfy the Supabase security linter.
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
-- generation_requests — one row per (profile, idempotency_key) generation
-- attempt. The unique(profile_id, idempotency_key) constraint is the race-safe
-- dedupe primitive: the first INSERT wins; concurrent duplicates hit the unique
-- violation and are evaluated against the existing row's status/hash.
-- ---------------------------------------------------------------------------
create table if not exists generation_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references profiles (id) on delete cascade,
  idempotency_key text not null,
  tool_key text not null,
  route_key text not null,
  request_hash text not null,
  status text not null default 'started' check (status in ('started', 'succeeded', 'failed')),
  job_id uuid references jobs (id) on delete set null,
  asset_id uuid references assets (id) on delete set null,
  response_json jsonb,
  error_json jsonb,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, idempotency_key)
);

drop trigger if exists generation_requests_set_updated_at on generation_requests;
create trigger generation_requests_set_updated_at
  before update on generation_requests
  for each row execute function public.krakatoa_set_updated_at();

-- Read-perf + housekeeping indexes (all additive).
create index if not exists generation_requests_profile_status_idx
  on generation_requests (profile_id, status);
create index if not exists generation_requests_created_idx
  on generation_requests (created_at desc);
create index if not exists generation_requests_job_idx
  on generation_requests (job_id);

-- ---------------------------------------------------------------------------
-- RLS — deny-by-default. Server routes use the service role (which bypasses RLS)
-- and enforce profile_id ownership in app code. No anon/authenticated policies
-- are created, so non-service roles get zero rows.
-- ---------------------------------------------------------------------------
alter table generation_requests enable row level security;
