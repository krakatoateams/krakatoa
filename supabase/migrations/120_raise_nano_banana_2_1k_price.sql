-- 120_raise_nano_banana_2_1k_price.sql
-- Nano Banana 2 1K (Product Photo, Balanced 1K): 7 -> 8 credits per image (#464).
--
-- The price now follows the highest provider cost, so no provider loses money:
--   Replicate google/nano-banana-2  $0.067 (migration 114)
--   fal       fal-ai/nano-banana-2  $0.080 (migration 115)  <- highest
--   credits = ceil(0.08 x 18000 x 1.0 / 200) = ceil(7.2) = 8   (8 credits earn $0.0889)
-- At 7 credits ($0.0778) every fal image lost about $0.002.
--
-- Updates only a row that still holds the original seed (7 credits, $0.067 from migration 011).
-- An admin-edited price or cost is never overwritten. Idempotent: a second run matches no row.
-- Billing reads credit_amount (Option A), so the new price applies within the ~60 s pricing cache.
-- provider_model_costs (per-provider margin data) is unchanged.
-- After running, check the row (expect 8 / 0.08; anything else means an admin had edited it):
--   select credit_amount, provider_cost_usd from pricing_configs
--   where pricing_key = 'product_photo_nano_banana_2_1k_per_image';

update pricing_configs
  set credit_amount = 8,
      provider_cost_usd = 0.08
  where pricing_key = 'product_photo_nano_banana_2_1k_per_image'
    and credit_amount = 7
    and provider_cost_usd = 0.067;
