-- 080_canvas_tool.sql
-- Create-section "Canvas" node workspace maps to tool_configs so sidebar
-- visibility, enable, and coming_soon are admin-toggleable from /admin/config-v2.
--
-- No new generation tables — canvas POSTs to generate-photo / generate-video.
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
  'canvas',
  'Canvas',
  true,
  true,
  false,
  8
)
on conflict (tool_key) do nothing;
