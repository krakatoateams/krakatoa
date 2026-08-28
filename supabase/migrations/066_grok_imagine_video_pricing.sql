-- 066_grok_imagine_video_pricing.sql
-- Grok Imagine Video (xai/grok-imagine-video) pricing + model config + composer enablement.
-- viral_template enablement is in 067_grok_viral_template_enablement.sql.
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('grok_imagine_480p_per_second', 'Grok Imagine Video 480p (per sec)', 'per_second', 5, 0.05, 'per_second', 'grok_imagine', '480p', 'USD'),
  ('grok_imagine_720p_per_second', 'Grok Imagine Video 720p (per sec)', 'per_second', 8, 0.08, 'per_second', 'grok_imagine', '720p', 'USD')
on conflict (pricing_key) do nothing;

update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in ('grok_imagine_480p_per_second', 'grok_imagine_720p_per_second');

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('reels', 'video_grok_imagine', 'replicate', 'xai/grok-imagine-video', true, '{}'::jsonb)
on conflict (tool_key, config_key) do nothing;

insert into feature_model_configs (
  tool_key,
  feature_key,
  model_tier,
  enabled,
  is_default,
  sort_order
)
values
  ('reels', 'text2video', 'grok_imagine_video', true, false, 14),
  ('reels', 'image2video', 'grok_imagine_video', true, false, 4)
on conflict (tool_key, feature_key, model_tier) do nothing;
