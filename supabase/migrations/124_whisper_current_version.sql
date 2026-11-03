-- Replicate disabled incredibly-fast-whisper version 3ab86df6 ("Version
-- disabled", 422), which broke Scheduler caption transcription and the
-- Reels/Veo word-timestamp step (#489). Move every whisper row still pinned
-- to it onto the current version c6433aab (same input schema and output
-- shape, verified 2026-11-03). Rows an admin already moved elsewhere are
-- left alone, so this is safe to re-run.

update model_configs
set parameters = jsonb_set(coalesce(parameters, '{}'::jsonb), '{version}', '"c6433aab18b7318bbae316495f1a097fc067deef7d59dc2f33e45077ae5956c7"'::jsonb),
    updated_at = now()
where config_key = 'whisper'
  and provider = 'replicate'
  and model = 'vaibhavs10/incredibly-fast-whisper'
  and parameters ->> 'version' = '3ab86df6c8f54c11309d4d1f930ac292bad43ace52d10c80d87eb258b3c9f79c';
