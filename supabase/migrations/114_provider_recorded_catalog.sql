-- 114_provider_recorded_catalog.sql
-- Phase 3 of the multi-provider rollout: remember which AI provider handled each
-- prediction/submission, and add the per-(provider, model) cost table.
-- Additive and idempotent. Existing rows backfill to 'replicate' via the column
-- default (Postgres applies a constant default to existing rows on ADD COLUMN).
-- No RPC signature changes: the fence RPCs insert without a provider and get the
-- default, so no grant/revoke lines are needed (see 067).

alter table generation_predictions
  add column if not exists provider text not null default 'replicate';

alter table generation_provider_submissions
  add column if not exists provider text not null default 'replicate';

-- Per-(provider, model, pricing_key) provider cost, admin-editable. Margin and
-- analytics only: billing still reads pricing_configs (credit_amount) and does
-- NOT read this table. Seeded from the code-defined Replicate costs.
create table if not exists provider_model_costs (
  provider text not null,
  model text not null,
  pricing_key text not null,
  cost_usd numeric not null check (cost_usd >= 0),
  cost_unit text not null default 'per_image',
  updated_by_profile_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, model, pricing_key)
);

drop trigger if exists provider_model_costs_set_updated_at on provider_model_costs;
create trigger provider_model_costs_set_updated_at
  before update on provider_model_costs
  for each row execute function public.krakatoa_set_updated_at();

-- Deny-by-default RLS, no policies: service role only (same model as 023/067).
alter table provider_model_costs enable row level security;

insert into provider_model_costs (provider, model, pricing_key, cost_usd, cost_unit)
values
  ('replicate', 'google/nano-banana', 'product_photo_nano_banana_per_image', 0.039, 'per_image'),
  ('replicate', 'google/nano-banana-2', 'product_photo_nano_banana_2_1k_per_image', 0.067, 'per_image'),
  ('replicate', 'google/nano-banana-2', 'product_photo_nano_banana_2_2k_per_image', 0.101, 'per_image'),
  ('replicate', 'google/nano-banana-2', 'product_photo_nano_banana_2_4k_per_image', 0.151, 'per_image'),
  ('replicate', 'google/nano-banana-pro', 'product_photo_nano_banana_pro_1k_per_image', 0.15, 'per_image'),
  ('replicate', 'google/nano-banana-pro', 'product_photo_nano_banana_pro_2k_per_image', 0.15, 'per_image'),
  ('replicate', 'google/nano-banana-pro', 'product_photo_nano_banana_pro_4k_per_image', 0.3, 'per_image'),
  ('replicate', 'openai/gpt-image-2.5-flare', 'product_photo_gpt_image_2_low_per_image', 0.012, 'per_image'),
  ('replicate', 'openai/gpt-image-2.5-flare', 'product_photo_gpt_image_2_medium_per_image', 0.047, 'per_image'),
  ('replicate', 'openai/gpt-image-2.5-flare', 'product_photo_gpt_image_2_high_per_image', 0.128, 'per_image')
on conflict (provider, model, pricing_key) do nothing;
