-- Retire openai/gpt-image-2: storyboard sheets move to GPT Image 2.5 Flare.
-- Covers the untouched 007 seed and any admin-saved row on the old slug; no-op once applied.
update model_configs
set model = 'openai/gpt-image-2.5-flare'
where model = 'openai/gpt-image-2';
