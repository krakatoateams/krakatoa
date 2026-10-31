-- 119_generation_batch_items.sql
-- S2: per-image outcome of a multi-image Fal photo request that had at least one image with an
-- unknown provider outcome. Lets reconcile settle each image on its own. Additive and idempotent.
-- The app works without this migration (rows are simply not written and reconcile skips the scan).
create table if not exists generation_batch_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  generation_request_id uuid references generation_requests (id) on delete set null,
  batch_index integer not null check (batch_index >= 0),
  asset_id uuid references assets (id) on delete set null,
  provider text not null,
  prediction_id text,                 -- null when submit itself failed (nothing to ask Fal)
  output_url text,                    -- Fal output URL when it was known but download/save failed
  credits integer not null check (credits >= 0),   -- per-image price charged in the spend
  state text not null check (state in (
    'delivered', 'failed_definitive', 'cancelled_confirmed', 'ambiguous',
    'delivering', 'refunded', 'delivered_late', 'unresolved')),
  refund_idempotency_key text,        -- key of the ledger row that refunded this image, if any
  delivery jsonb,                     -- save parameters for late delivery (ambiguous rows only)
  error_code text,
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, batch_index)
);

drop trigger if exists generation_batch_items_set_updated_at on generation_batch_items;
create trigger generation_batch_items_set_updated_at
  before update on generation_batch_items
  for each row execute function public.krakatoa_set_updated_at();

-- Reconcile scan: only open rows, keyset by (created_at, id).
create index if not exists generation_batch_items_open_idx
  on generation_batch_items (created_at, id) where state in ('ambiguous', 'delivering');
create index if not exists generation_batch_items_job_idx on generation_batch_items (job_id);

alter table generation_batch_items enable row level security;
