-- 067_grok_viral_template_enablement.sql
-- Enable Grok Imagine Video for viral_template (character image only; template via prompt).
--
-- Additive + idempotent — safe to re-run via Supabase MCP or npm run db:setup.

insert into feature_model_configs (
  tool_key,
  feature_key,
  model_tier,
  enabled,
  is_default,
  sort_order
)
values
  ('reels', 'viral_template', 'grok_imagine_video', true, false, 6)
on conflict (tool_key, feature_key, model_tier) do nothing;
