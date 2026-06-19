-- 019_kling3_motion_control_pricing.sql
-- Kling v3 Motion Control (kwaivgi/kling-v3-motion-control) pricing — the Motion
-- Control sub-tool under Text to Video.
--
-- Motion Control animates a reference character image with the motion from a
-- reference video. It is priced by `mode` (std=720p / pro=1080p). The output clip
-- length follows the reference video (clamped to the orientation cap), and that
-- billed duration drives the per-second cost.
--
-- Pricing (USD per second of output video):
--   std (720p)  $0.07
--   pro (1080p) $0.12
--
-- Rows are added so the rate is visible AND editable in the Admin pricing panel
-- (the list reads pricing_configs directly), instead of living only as a built-in
-- code default. The route selects the variant key from mode.
--
-- Additive + idempotent (insert ... on conflict do nothing) — safe to re-run via
-- `npm run db:setup`. RLS unchanged (deny-by-default; service role only).

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('kling3mc_std_per_second', 'Kling v3 Motion Control Std 720p (per sec)',  'per_second', 7,  0.07, 'per_second', 'kling3mc', 'std', 'USD'),
  ('kling3mc_pro_per_second', 'Kling v3 Motion Control Pro 1080p (per sec)', 'per_second', 11, 0.12, 'per_second', 'kling3mc', 'pro', 'USD')
on conflict (pricing_key) do nothing;

-- Defensive: these are active source-of-truth rows — make sure a re-run never
-- leaves them deprecated. Never touches credit_amount / enabled / admin edits.
update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in (
      'kling3mc_std_per_second',
      'kling3mc_pro_per_second'
    );
