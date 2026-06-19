-- 014_seedance_video_in_pricing.sql
-- Seedance 2 "video_in" pricing variant (Text to Video).
--
-- Seedance 2 charges a HIGHER per-second rate when a reference VIDEO is provided
-- ("video_in") than when one is not ("non_video_in"). The existing rows
-- (seedance_480p_per_second $0.07, seedance_720p_per_second $0.15) are the
-- non_video_in tier and stay unchanged (still used by Reels/Storyboard and by
-- Text to Video when no reference video is attached).
--
-- This migration adds the two video_in rows so the rate is visible AND editable
-- in the Admin pricing panel (the list reads pricing_configs directly), instead
-- of living only as a built-in code default. The Text to Video route selects the
-- variant key at runtime based on whether a reference video is present.
--
-- Additive + idempotent (insert ... on conflict do nothing) — safe to re-run via
-- `npm run db:setup`. RLS unchanged (deny-by-default; service role only).

insert into pricing_configs
  (pricing_key, display_name, pricing_type, credit_amount, provider_cost_usd, cost_unit, pricing_group, variant_key, currency)
values
  ('seedance_480p_video_in_per_second', 'Seedance 480p · Video input (per sec)', 'per_second', 8,  0.08, 'per_second', 'seedance', '480p_video_in', 'USD'),
  ('seedance_720p_video_in_per_second', 'Seedance 720p · Video input (per sec)', 'per_second', 16, 0.17, 'per_second', 'seedance', '720p_video_in', 'USD')
on conflict (pricing_key) do nothing;

-- Defensive: these are active source-of-truth rows — make sure a re-run never
-- leaves them deprecated. Never touches credit_amount / enabled / admin edits.
update pricing_configs
  set is_deprecated = false
  where is_deprecated = true
    and pricing_key in (
      'seedance_480p_video_in_per_second',
      'seedance_720p_video_in_per_second'
    );
