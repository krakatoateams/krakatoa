-- 055_generation_cancel_allowed.sql
-- After Replicate delivers primary output, in-flight cancel must not refund (provider cost committed).
-- Flipped to false by markProviderCommitted(); reset true on idempotency takeover.

alter table generation_requests
  add column if not exists cancel_allowed boolean not null default true;
