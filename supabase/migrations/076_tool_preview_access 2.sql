-- 076_tool_preview_access.sql
-- Narrow, admin-managed allowlist for previewing a coming_soon-gated tool
-- page WITHOUT granting full /admin panel access (that's admin_users — a much
-- bigger grant: pricing, model config, every other admin surface).
--
-- Built for handing a specific external account (e.g. a Google OAuth
-- verification reviewer's test login) access to see/use a tool like Scheduler
-- while it's still coming_soon, without also making that account a real
-- admin. See app/(app)/tools/scheduler/page.tsx and .../calendar/page.tsx.
--
-- Global on purpose (not per-tool): being on this list bypasses ANY
-- coming_soon gate, not just one specific tool. Simpler, and the only use
-- case so far (an external reviewer account) needs exactly that.
--
-- Additive, idempotent, non-destructive (safe to re-run via `npm run db:setup`).
-- Security model: RLS enabled deny-by-default with NO policies; only the
-- server (service role) reads/writes this table.

create extension if not exists pgcrypto;

-- Shared updated_at trigger helper (re-declared idempotently; also in 048/053/062/065).
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

create table if not exists tool_preview_access (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  -- Free-text reason, e.g. "Google OAuth verification reviewer account" —
  -- purely for the admin managing this list, never shown to the user.
  note text,
  granted_by_profile_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists tool_preview_access_set_updated_at on tool_preview_access;
create trigger tool_preview_access_set_updated_at
  before update on tool_preview_access
  for each row execute function public.krakatoa_set_updated_at();

alter table tool_preview_access enable row level security;
