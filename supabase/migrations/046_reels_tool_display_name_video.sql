-- Rename tool_configs display label: ReelsGen → Video (sidebar already says "Video").
update tool_configs
set display_name = 'Video'
where tool_key = 'reels' and display_name = 'ReelsGen';
