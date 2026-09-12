-- Align the untouched Scheduler LLM seed with the runtime fallback.
-- Preserve any row that an admin has explicitly edited.

update model_configs
set model = 'openai/gpt-5'
where tool_key = 'schedule'
  and config_key = 'llm'
  and provider = 'replicate'
  and model = 'google/gemini-2.5-flash'
  and parameters = '{}'::jsonb
  and updated_by_profile_id is null;
