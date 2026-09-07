-- 085_editor_tool.sql
-- Create-section "Editor" timeline maps to tool_configs so sidebar
-- visibility, enable, and coming_soon are admin-toggleable from /admin/config-v2.
--
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
  'editor',
  'Editor',
  true,
  true,
  false,
  9
)
on conflict (tool_key) do nothing;
