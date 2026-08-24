-- 064_virtual_creator_tool.sql
-- Landing "Virtual Creator" feature maps to tool_configs so its Soon badge
-- is admin-toggleable from /admin/config-v2 (coming_soon), same as Schedule.
--
-- No sidebar entry and no generation routes — presentational only.
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
  'virtual_creator',
  'Virtual Creator',
  true,
  false,
  true,
  6
)
on conflict (tool_key) do nothing;
