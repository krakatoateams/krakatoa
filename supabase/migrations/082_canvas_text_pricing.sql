-- 082_canvas_text_pricing.sql
-- Canvas Text node — Gemini 2.5 Flash rewrite (per run).
--
-- Provider cost ~$0.01/run → 1 credit at the current internal-testing knobs
-- (usd_to_idr=18000, credit_value_idr=200, margin=1.0 → factor 90).
-- pricing_type stays in the existing check constraint ('fixed' | 'per_second' |
-- 'per_image'); cost_unit is the v2 runtime unit (`per_run`).
--
-- Additive + idempotent (insert ... on conflict do nothing). RLS unchanged.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('canvas_text_per_run', 'Canvas Text (Gemini)', 'fixed', 1, 0.01, 'per_run', 'canvas', 'text', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key = 'canvas_text_per_run';
