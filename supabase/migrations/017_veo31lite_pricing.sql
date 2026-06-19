-- 017_veo31lite_pricing.sql
-- Veo 3.1 Lite (google/veo-3.1-lite) pricing — Text to Video.
--
-- Veo 3.1 Lite has NO audio generation and is priced by resolution. (1080p only
-- supports an 8s clip — enforced in the model/route, not in pricing.) These rows
-- are kept separate from the existing `veo` group (used by the Reels Creator) and
-- the `veo31fast` group so admins can tune Lite independently.
--
-- Pricing (USD per second of output video):
--   720p  $0.05
--   1080p $0.08
--
-- Rows are added so the rate is visible AND editable in the Admin pricing panel
-- (the list reads pricing_configs directly), instead of living only as a built-in
-- code default. The Text to Video route selects the variant key from resolution.
--
-- Additive + idempotent (insert ... on conflict do nothing) — safe to re-run via
-- `npm run db:setup`. RLS unchanged (deny-by-default; service role only).

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('veo31lite_720p_per_second',  'Veo 3.1 Lite 720p (per sec)',  'per_second', 5, 0.05, 'per_second', 'veo31lite', '720p',  'USD'),
  ('veo31lite_1080p_per_second', 'Veo 3.1 Lite 1080p (per sec)', 'per_second', 8, 0.08, 'per_second', 'veo31lite', '1080p', 'USD')
on conflict (pricing_key) do nothing;

-- Defensive: these are active source-of-truth rows — make sure a re-run never
-- leaves them deprecated. Never touches credit_amount / enabled / admin edits.
update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in (
      'veo31lite_720p_per_second',
      'veo31lite_1080p_per_second'
    );
