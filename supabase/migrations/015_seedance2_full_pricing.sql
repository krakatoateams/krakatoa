-- 015_seedance2_full_pricing.sql
-- Seedance 2.0 (full, bytedance/seedance-2.0) pricing — Text to Video.
--
-- The full Seedance 2.0 model is a separate, pricier model than Seedance 2 Fast
-- (the existing `seedance_*` rows, which stay unchanged and remain used by
-- Reels/Storyboard and the Fast Text-to-Video model). The full model also adds a
-- 1080p tier on top of 480p/720p. Like the Fast variant, it charges a higher
-- per-second rate when a reference VIDEO is provided ("video_in") than when not
-- ("non_video_in").
--
-- Pricing (USD per second of output video):
--   480p  : non_video_in $0.08 · video_in $0.10
--   720p  : non_video_in $0.18 · video_in $0.22
--   1080p : non_video_in $0.45 · video_in $0.55
--
-- These rows are added so the rate is visible AND editable in the Admin pricing
-- panel (the list reads pricing_configs directly), instead of living only as a
-- built-in code default. The Text to Video route selects the variant key at
-- runtime based on resolution + whether a reference video is present.
--
-- Additive + idempotent (insert ... on conflict do nothing) — safe to re-run via
-- `npm run db:setup`. RLS unchanged (deny-by-default; service role only).

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('seedance2_480p_per_second',           'Seedance 2.0 480p (per sec)',                 'per_second', 8,  0.08, 'per_second', 'seedance2', '480p',           'USD'),
  ('seedance2_720p_per_second',           'Seedance 2.0 720p (per sec)',                 'per_second', 17, 0.18, 'per_second', 'seedance2', '720p',           'USD'),
  ('seedance2_1080p_per_second',          'Seedance 2.0 1080p (per sec)',                'per_second', 41, 0.45, 'per_second', 'seedance2', '1080p',          'USD'),
  ('seedance2_480p_video_in_per_second',  'Seedance 2.0 480p · Video input (per sec)',   'per_second', 9,  0.10, 'per_second', 'seedance2', '480p_video_in',  'USD'),
  ('seedance2_720p_video_in_per_second',  'Seedance 2.0 720p · Video input (per sec)',   'per_second', 20, 0.22, 'per_second', 'seedance2', '720p_video_in',  'USD'),
  ('seedance2_1080p_video_in_per_second', 'Seedance 2.0 1080p · Video input (per sec)',  'per_second', 50, 0.55, 'per_second', 'seedance2', '1080p_video_in', 'USD')
on conflict (pricing_key) do nothing;

-- Defensive: these are active source-of-truth rows — make sure a re-run never
-- leaves them deprecated. Never touches credit_amount / enabled / admin edits.
update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in (
      'seedance2_480p_per_second',
      'seedance2_720p_per_second',
      'seedance2_1080p_per_second',
      'seedance2_480p_video_in_per_second',
      'seedance2_720p_video_in_per_second',
      'seedance2_1080p_video_in_per_second'
    );
