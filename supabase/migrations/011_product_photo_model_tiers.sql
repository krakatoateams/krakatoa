-- 011_product_photo_model_tiers.sql
-- Product Photo Pricing/Model Correction v2.3 — Basic / Balanced / Pro tiers.
--
-- Background: Product Photo was previously modeled as if it ran Nano Banana Pro
-- with 1K/2K/4K pricing, but the app actually called plain google/nano-banana
-- (which has NO resolution param and a different price). This migration replaces
-- that ambiguous model with three EXPLICIT provider models, each with accurate
-- provider-cost pricing:
--   * basic    -> google/nano-banana      (no resolution)              $0.039
--   * balanced -> google/nano-banana-2     (1K/2K/4K)  $0.067/$0.101/$0.151
--   * pro      -> google/nano-banana-pro   (1K/2K/4K)  $0.15 /$0.15 /$0.30
--
-- Credits at the current internal-testing knobs (usd_to_idr=18000,
-- credit_value_idr=200, margin=1.0 => factor 90, single final ceil):
--   basic 4 · balanced 7/10/14 · pro 14/14/27.
--
-- What it does:
--   1) Seeds 7 new v2 provider-cost pricing rows (enabled, not deprecated).
--   2) Soft-deprecates + disables the 4 old ambiguous Product Photo v2 rows
--      (product_photo_fallback/1k/2k/4k_per_image) — kept for audit, never read.
--   3) Seeds 3 new model_configs roles (photo.image_basic/balanced/pro).
--   4) Soft-retires the legacy photo.image model role (enabled=false,
--      metadata.deprecated=true) — kept for audit, no hard delete.
--
-- Additive + idempotent (insert ... on conflict do nothing + guarded updates) —
-- safe to re-run via `npm run db:setup`. NO hard deletes (soft flags only).
--
-- Security model (unchanged from 003/004/007/009/010): RLS stays enabled
-- deny-by-default with NO policies; server routes use the service role and
-- enforce access in application code. This migration changes data only and does
-- not alter RLS on pricing_configs or model_configs.

-- ---------------------------------------------------------------------------
-- 1) Seed the 7 new Product Photo provider-cost pricing rows.
--    Relies on the pricing_configs defaults enabled=true / is_deprecated=false.
--    on conflict do nothing never clobbers an existing admin-edited row.
-- ---------------------------------------------------------------------------
insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('product_photo_nano_banana_per_image',       'Product Photo — Basic (Nano Banana)',        'per_image', 4,  0.039, 'per_image', 'product_photo', 'basic',       'USD'),
  ('product_photo_nano_banana_2_1k_per_image',  'Product Photo — Balanced 1K (Nano Banana 2)', 'per_image', 7,  0.067, 'per_image', 'product_photo', 'balanced_1k', 'USD'),
  ('product_photo_nano_banana_2_2k_per_image',  'Product Photo — Balanced 2K (Nano Banana 2)', 'per_image', 10, 0.101, 'per_image', 'product_photo', 'balanced_2k', 'USD'),
  ('product_photo_nano_banana_2_4k_per_image',  'Product Photo — Balanced 4K (Nano Banana 2)', 'per_image', 14, 0.151, 'per_image', 'product_photo', 'balanced_4k', 'USD'),
  ('product_photo_nano_banana_pro_1k_per_image', 'Product Photo — Pro 1K (Nano Banana Pro)',    'per_image', 14, 0.15,  'per_image', 'product_photo', 'pro_1k',      'USD'),
  ('product_photo_nano_banana_pro_2k_per_image', 'Product Photo — Pro 2K (Nano Banana Pro)',    'per_image', 14, 0.15,  'per_image', 'product_photo', 'pro_2k',      'USD'),
  ('product_photo_nano_banana_pro_4k_per_image', 'Product Photo — Pro 4K (Nano Banana Pro)',    'per_image', 27, 0.30,  'per_image', 'product_photo', 'pro_4k',      'USD')
on conflict (pricing_key) do nothing;

-- Defensive: ensure the 7 new rows are runtime-active (enabled, not deprecated)
-- in case a prior partial run created them in a bad state. Does NOT touch
-- provider_cost_usd / credit_amount, so admin cost edits are preserved.
update pricing_configs
  set is_deprecated = false,
      enabled = true
  where pricing_key in (
      'product_photo_nano_banana_per_image',
      'product_photo_nano_banana_2_1k_per_image',
      'product_photo_nano_banana_2_2k_per_image',
      'product_photo_nano_banana_2_4k_per_image',
      'product_photo_nano_banana_pro_1k_per_image',
      'product_photo_nano_banana_pro_2k_per_image',
      'product_photo_nano_banana_pro_4k_per_image'
    )
    and (is_deprecated = true or enabled = false);

-- ---------------------------------------------------------------------------
-- 2) Soft-deprecate + disable the 4 old ambiguous Product Photo v2 rows.
--    These keys assumed Nano Banana Pro but were charged against plain
--    google/nano-banana — superseded by the model-tier rows above. Kept (not
--    deleted) for audit; enabled=false + is_deprecated=true hides them from the
--    normal admin pricing list and the public payload, and the runtime resolver
--    no longer maps any tool to them.
-- ---------------------------------------------------------------------------
update pricing_configs
  set is_deprecated = true,
      enabled = false
  where pricing_key in (
    'product_photo_fallback_per_image',
    'product_photo_1k_per_image',
    'product_photo_2k_per_image',
    'product_photo_4k_per_image'
  );

-- ---------------------------------------------------------------------------
-- 3) Seed the 3 new Product Photo model roles. provider is the delivery
--    provider (Replicate); the google/ prefix is part of the Replicate model id.
--    on conflict do nothing never clobbers an existing admin-edited row.
-- ---------------------------------------------------------------------------
insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('photo', 'image_basic',    'replicate', 'google/nano-banana',     true, '{}'::jsonb),
  ('photo', 'image_balanced', 'replicate', 'google/nano-banana-2',   true, '{}'::jsonb),
  ('photo', 'image_pro',      'replicate', 'google/nano-banana-pro', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;

-- Defensive: ensure the 3 new model roles are enabled (re-enable only if a prior
-- partial run left them disabled). Does NOT touch provider/model so admin edits
-- are preserved.
update model_configs
  set enabled = true
  where tool_key = 'photo'
    and config_key in ('image_basic', 'image_balanced', 'image_pro')
    and enabled = false;

-- ---------------------------------------------------------------------------
-- 4) Soft-retire the legacy single Product Photo model role (photo.image).
--    Replaced by the per-tier roles above. Disabled + metadata.deprecated=true;
--    no hard delete. The model resolver no longer reads this role for Product
--    Photo (getPhotoModel() uses the per-tier roles), and its built-in fallback
--    keeps any legacy caller working.
-- ---------------------------------------------------------------------------
update model_configs
  set enabled = false,
      metadata = coalesce(metadata, '{}'::jsonb) || '{"deprecated": true}'::jsonb
  where tool_key = 'photo'
    and config_key = 'image';
