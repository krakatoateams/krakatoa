-- 077_skills_tool.sql
-- Create-section "Skills" catalog maps to tool_configs so sidebar visibility,
-- enable, and coming_soon are admin-toggleable from /admin/config-v2.
--
-- No new generation tables — skills POST to generate-photo / generate-video.
-- Additive, idempotent, non-destructive.

insert into tool_configs (
  tool_key,
  display_name,
  enabled,
  visible_in_sidebar,
  coming_soon,
  sort_order
)
values (
  'skills',
  'Skills',
  true,
  true,
  false,
  7
)
on conflict (tool_key) do nothing;
