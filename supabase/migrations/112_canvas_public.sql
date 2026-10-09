-- Open Canvas to everyone. The tool was seeded available and later
-- marked coming soon from admin config; this launches it.

update public.tool_configs
set coming_soon = false
where tool_key = 'canvas';
