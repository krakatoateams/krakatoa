-- 117_admin_config_audit_log.sql
-- Phase 6 of the multi-provider rollout: who switched which model's AI provider, and when.
-- Additive and idempotent. The app writes entries best-effort and works without this table.
create table if not exists admin_config_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_profile_id uuid references profiles (id) on delete set null,
  action text not null,
  tool_key text not null,
  config_key text not null,
  from_value text,
  to_value text,
  created_at timestamptz not null default now()
);

create index if not exists admin_config_audit_log_created_idx
  on admin_config_audit_log (created_at desc);

-- Deny-by-default RLS, no policies: service role only (same model as 023/067).
alter table admin_config_audit_log enable row level security;
