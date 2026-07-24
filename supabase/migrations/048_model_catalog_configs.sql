-- 048_model_catalog_configs.sql
-- Admin Config v2 Phase 3 — per-model catalog on/off (tool_key + model_id).
-- Missing row = shipped default (enabled). Rows materialized from code on admin GET.

create table if not exists model_catalog_configs (
  id uuid primary key default gen_random_uuid(),
  tool_key text not null,
  model_id text not null,
  enabled boolean not null default true,
  sort_order int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_by_profile_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tool_key, model_id)
);

drop trigger if exists model_catalog_configs_set_updated_at on model_catalog_configs;
create trigger model_catalog_configs_set_updated_at
  before update on model_catalog_configs
  for each row execute function public.krakatoa_set_updated_at();

create index if not exists model_catalog_configs_lookup_idx
  on model_catalog_configs (tool_key, model_id);

alter table model_catalog_configs enable row level security;
