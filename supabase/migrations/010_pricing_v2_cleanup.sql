-- 010_pricing_v2_cleanup.sql
-- Pricing Config v2.2 — Clean Runtime Pricing Model, No Legacy Confusion.
--
-- Makes v2 provider-cost rows the ONLY normal runtime/admin pricing model:
--   * Adds pricing_configs.is_deprecated (default false).
--   * Soft-deprecates + disables the five legacy generation pricing rows so they
--     no longer appear as runtime-active pricing in the admin panel and are never
--     read by the runtime resolver (which now uses v2 rows + built-in v2 defaults
--     from lib/pricing-defaults.ts, never the old 2-credits/sec legacy rows).
--   * Idempotently re-seeds the v2 provider-cost rows as a no-op safety net.
--
-- Reversible in spirit: uses SOFT flags (is_deprecated + enabled=false). NO hard
-- delete — the legacy rows stay in the table for audit/history and can be
-- un-deprecated by flipping the flag back.
--
-- Additive and idempotent (add column if not exists / guarded updates /
-- insert ... on conflict do nothing) — safe to re-run via `npm run db:setup`.
--
-- Security model (unchanged from 003/004/007/009): RLS stays enabled
-- deny-by-default with NO policies; server routes use the service role and
-- enforce access in application code. This migration adds a column only and does
-- not alter RLS on pricing_configs.

-- ---------------------------------------------------------------------------
-- 1) is_deprecated flag — soft-deprecation marker.
-- ---------------------------------------------------------------------------
alter table pricing_configs
  add column if not exists is_deprecated boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2) Soft-deprecate + disable the five legacy GENERATION pricing rows.
--    These keys are no longer a runtime pricing source (the resolver maps each
--    tool to a v2 provider-cost key). Keeping the rows (not deleting) preserves
--    history; enabled=false + is_deprecated=true hides them from the normal
--    admin pricing list and from the public pricing payload.
--
--    initial_dummy_credits is intentionally EXCLUDED: it is a platform credit
--    grant, not a generation price, and must keep working.
-- ---------------------------------------------------------------------------
update pricing_configs
  set is_deprecated = true,
      enabled = false
  where pricing_key in (
    'product_photo',
    'storyboard_image',
    'storyboard_video',
    'seedance_video_per_second',
    'veo_video_per_second'
  );

-- ---------------------------------------------------------------------------
-- 3) Idempotent v2 re-seed (no-op safety net). Mirrors 009's seed verbatim so a
--    DB that somehow missed 009's insert still gets the v2 rows. on conflict do
--    nothing never clobbers admin edits to existing v2 rows.
-- ---------------------------------------------------------------------------
insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('seedance_480p_per_second', 'Seedance 480p (per sec)',  'per_second', 7,  0.07, 'per_second', 'seedance',         '480p', 'USD'),
  ('seedance_720p_per_second', 'Seedance 720p (per sec)',  'per_second', 14, 0.15, 'per_second', 'seedance',         '720p', 'USD'),
  ('veo_720p_per_second',      'Veo 720p (per sec)',       'per_second', 5,  0.05, 'per_second', 'veo',              '720p', 'USD'),
  ('veo_1080p_per_second',     'Veo 1080p (per sec)',      'per_second', 8,  0.08, 'per_second', 'veo',              '1080p','USD'),
  ('storyboard_gpt_image_2_low_per_image',    'Storyboard Image — Low',    'per_image', 2,  0.012, 'per_image', 'storyboard_image', 'low',    'USD'),
  ('storyboard_gpt_image_2_medium_per_image', 'Storyboard Image — Medium', 'per_image', 5,  0.047, 'per_image', 'storyboard_image', 'medium', 'USD'),
  ('storyboard_gpt_image_2_auto_per_image',   'Storyboard Image — Auto',   'per_image', 12, 0.128, 'per_image', 'storyboard_image', 'auto',   'USD'),
  ('product_photo_fallback_per_image', 'Product Photo — Fallback/Low', 'per_image', 4,  0.035, 'per_image', 'product_photo', 'fallback', 'USD'),
  ('product_photo_1k_per_image',       'Product Photo — 1K',           'per_image', 14, 0.15,  'per_image', 'product_photo', '1k',       'USD'),
  ('product_photo_2k_per_image',       'Product Photo — 2K',           'per_image', 14, 0.15,  'per_image', 'product_photo', '2k',       'USD'),
  ('product_photo_4k_per_image',       'Product Photo — 4K',           'per_image', 27, 0.30,  'per_image', 'product_photo', '4k',       'USD')
on conflict (pricing_key) do nothing;

-- ---------------------------------------------------------------------------
-- 4) Defensive: ensure the v2 provider-cost rows are NOT marked deprecated
--    (they are the source of truth). Never touches credit_amount / enabled.
-- ---------------------------------------------------------------------------
update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in (
      'seedance_480p_per_second', 'seedance_720p_per_second',
      'veo_720p_per_second', 'veo_1080p_per_second',
      'storyboard_gpt_image_2_low_per_image',
      'storyboard_gpt_image_2_medium_per_image',
      'storyboard_gpt_image_2_auto_per_image',
      'product_photo_fallback_per_image',
      'product_photo_1k_per_image',
      'product_photo_2k_per_image',
      'product_photo_4k_per_image'
    );
