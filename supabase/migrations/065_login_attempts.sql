-- 065_login_attempts.sql
-- Per-email login lockout: after 5 failed password attempts, block further
-- attempts against that email for 5 minutes (app/api/auth/signin/route.ts).
--
-- Keyed by email, not IP — the goal is protecting a specific account from
-- credential guessing, not general request throttling. A known, accepted
-- tradeoff: someone who only knows the target's email can grief-lock it for
-- 5 minutes at a time without ever guessing the password. Low severity
-- compared to leaving accounts unprotected against brute force.
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).
-- Security model: RLS enabled deny-by-default with NO policies; only the
-- server route (service role) reads/writes this table.

create extension if not exists pgcrypto;

-- Shared updated_at trigger helper (re-declared idempotently; also in 048/053/062).
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
-- login_attempts — one row per email currently being tracked. A row is
-- created/updated on a failed attempt and deleted on a successful sign-in
-- (see clearLoginAttempts in the route) — rows never accumulate for accounts
-- that aren't actively being guessed at.
-- ---------------------------------------------------------------------------
create table if not exists login_attempts (
  email text primary key,
  failed_count int not null default 0,
  locked_until timestamptz,
  last_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists login_attempts_set_updated_at on login_attempts;
create trigger login_attempts_set_updated_at
  before update on login_attempts
  for each row execute function public.krakatoa_set_updated_at();

alter table login_attempts enable row level security;
