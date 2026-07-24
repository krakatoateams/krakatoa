-- Scheduler AI caption pipeline (LLM + Whisper) — admin-editable via model_configs.

insert into model_configs (tool_key, config_key, provider, model, is_default, parameters)
values
  ('schedule', 'llm', 'replicate', 'google/gemini-2.5-flash', true, '{}'::jsonb),
  ('schedule', 'whisper', 'replicate', 'vaibhavs10/incredibly-fast-whisper', true,
     '{"version":"3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c"}'::jsonb)
on conflict (tool_key, config_key) do nothing;
