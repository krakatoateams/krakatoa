-- 018_kling3_pricing.sql
-- Kling v3 (kwaivgi/kling-v3-video) pricing — Text to Video.
--
-- Kling v3 is priced by `mode` (standard=720p / pro=1080p / 4k) combined with
-- audio. 4k is a flat rate regardless of audio, so it gets a single key. The
-- model surfaces `mode` in the UI as a resolution chip (720p/1080p/4k) and the
-- route translates it back to `mode` for the provider.
--
-- Pricing (USD per second of output video):
--   standard (720p)  no audio $0.168 · audio $0.252
--   pro      (1080p) no audio $0.224 · audio $0.336
--   4k               $0.42 (audio or not)
--
-- Rows are added so the rate is visible AND editable in the Admin pricing panel
-- (the list reads pricing_configs directly), instead of living only as a built-in
-- code default. The Text to Video route selects the variant key from mode + audio.
--
-- Additive + idempotent (insert ... on conflict do nothing) — safe to re-run via
-- `npm run db:setup`. RLS unchanged (deny-by-default; service role only).

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('kling3_standard_per_second',       'Kling v3 Standard 720p (per sec)',          'per_second', 16, 0.168, 'per_second', 'kling3', 'standard',       'USD'),
  ('kling3_standard_audio_per_second', 'Kling v3 Standard 720p · Audio (per sec)',  'per_second', 23, 0.252, 'per_second', 'kling3', 'standard_audio', 'USD'),
  ('kling3_pro_per_second',            'Kling v3 Pro 1080p (per sec)',              'per_second', 21, 0.224, 'per_second', 'kling3', 'pro',            'USD'),
  ('kling3_pro_audio_per_second',      'Kling v3 Pro 1080p · Audio (per sec)',      'per_second', 31, 0.336, 'per_second', 'kling3', 'pro_audio',      'USD'),
  ('kling3_4k_per_second',             'Kling v3 4K (per sec)',                     'per_second', 38, 0.420, 'per_second', 'kling3', '4k',             'USD')
on conflict (pricing_key) do nothing;

-- Defensive: these are active source-of-truth rows — make sure a re-run never
-- leaves them deprecated. Never touches credit_amount / enabled / admin edits.
update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in (
      'kling3_standard_per_second',
      'kling3_standard_audio_per_second',
      'kling3_pro_per_second',
      'kling3_pro_audio_per_second',
      'kling3_4k_per_second'
    );
