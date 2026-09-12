-- 094_drop_legacy_credit_rpc_overload.sql
-- 050 added p_source / p_expires_at with defaults, which created a second
-- overload instead of replacing the 10-arg function from 004. Callers use
-- the lot-aware signature. Drop the leftover overload.

drop function if exists public.krakatoa_apply_credit_transaction(
  uuid, integer, text, text, text, text, jsonb, text, uuid, uuid
);
