-- 016_veo31fast_pricing.sql
-- Veo 3.1 Fast (google/veo-3.1-fast) pricing — Text to Video.
--
-- Unlike Seedance/Veo (resolution-based) rows, this model is priced by AUDIO:
-- generating synchronized audio costs more than generating silent video. The
-- per-second rate is the same across 720p/1080p.
--
-- Pricing (USD per second of output video):
--   with_audio    $0.15
--   without_audio $0.10
--
-- These rows are added so the rate is visible AND editable in the Admin pricing
-- panel (the list reads pricing_configs directly), instead of living only as a
-- built-in code default. The Text to Video route selects the variant key at
-- runtime based on the generate_audio toggle.
--
-- Additive + idempotent (insert ... on conflict do nothing) — safe to re-run via
-- `npm run db:setup`. RLS unchanged (deny-by-default; service role only).

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('veo31fast_with_audio_per_second',    'Veo 3.1 Fast · With audio (per sec)',    'per_second', 14, 0.15, 'per_second', 'veo31fast', 'with_audio',    'USD'),
  ('veo31fast_without_audio_per_second', 'Veo 3.1 Fast · Without audio (per sec)', 'per_second', 9,  0.10, 'per_second', 'veo31fast', 'without_audio', 'USD')
on conflict (pricing_key) do nothing;

-- Defensive: these are active source-of-truth rows — make sure a re-run never
-- leaves them deprecated. Never touches credit_amount / enabled / admin edits.
update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in (
      'veo31fast_with_audio_per_second',
      'veo31fast_without_audio_per_second'
    );
