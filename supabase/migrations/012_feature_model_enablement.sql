-- 012_feature_model_enablement.sql
-- Admin Config v3 — per-feature model enablement for Photo.
--
-- Background: the Photo tool exposes several creation features (Image generation,
-- Product try-on, Character generation). Each feature can use a subset of the
-- Photo model tiers (see lib/product-photo.ts PRODUCT_PHOTO_TIERS). Admins need to
-- enable/disable each model per feature and pick a per-feature default — a control
-- dimension the flat model_configs table does not capture.
--
-- This migration adds ONE table, feature_model_configs, keyed by
-- (tool_key, feature_key, model_tier). It does NOT seed rows: the rows are
-- materialized from the code catalog (lib/creation-features.ts) on the first
-- admin load (see lib/feature-model-configs-db.ts ensureFeatureModelRows), and the
-- runtime resolver treats a MISSING row as the shipped default (enabled). This
-- keeps the matrix aligned with the code catalog automatically, so adding a new
-- model tier in code never requires another migration.
--
-- Additive + idempotent (create table if not exists). NO hard deletes.
--
-- Security model (unchanged from 003/004/007/009/010/011): RLS enabled
-- deny-by-default with NO policies; server routes use the service role and enforce
-- admin authorization in application code (lib/admin-auth.ts). The runtime read is
-- service-role and never throws (falls back to code defaults).

create extension if not exists pgcrypto;

-- Project-specific updated_at trigger helper (idempotent; also created by 003/007).
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
-- feature_model_configs — per-feature model enablement.
--   tool_key    : creation type owner (currently always 'photo')
--   feature_key : 'image' | 'product' | 'character' (matches generate-photo mode)
--   model_tier  : a ProductPhotoModelTier id (e.g. 'basic', 'seedream4')
--   enabled     : whether this model is offered for this feature
--   is_default  : the pre-selected model for this feature (at most one per feature)
-- A missing (tool_key, feature_key, model_tier) row means "shipped default"
-- (enabled) at runtime, so the feature works before rows are materialized.
-- ---------------------------------------------------------------------------
create table if not exists feature_model_configs (
  id uuid primary key default gen_random_uuid(),
  tool_key text not null,
  feature_key text not null,
  model_tier text not null,
  enabled boolean not null default true,
  is_default boolean not null default false,
  sort_order int not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  updated_by_profile_id uuid references profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tool_key, feature_key, model_tier)
);

drop trigger if exists feature_model_configs_set_updated_at on feature_model_configs;
create trigger feature_model_configs_set_updated_at
  before update on feature_model_configs
  for each row execute function public.krakatoa_set_updated_at();

create index if not exists feature_model_configs_lookup_idx
  on feature_model_configs (tool_key, feature_key);

alter table feature_model_configs enable row level security;
