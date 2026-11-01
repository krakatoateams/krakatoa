-- 121_raise_nano_banana_2_2k_4k_price.sql
-- Nano Banana 2 (Product Photo, Balanced) 2K: 10 -> 11 and 4K: 14 -> 15 credits per image (#469).
--
-- The price follows the highest provider cost, so no provider loses money (same rule as #464 / 120):
--   2K  Replicate google/nano-banana-2 $0.101 (114)   fal fal-ai/nano-banana-2 $0.12 (115)  <- highest
--       credits = ceil(0.12 x 18000 x 1.0 / 200) = ceil(10.8) = 11   (11 credits earn $0.1222)
--   4K  Replicate $0.151 (114)                         fal $0.16 (115)                       <- highest
--       credits = ceil(0.16 x 18000 x 1.0 / 200) = ceil(14.4) = 15   (15 credits earn $0.1667)
-- At 10 / 14 credits every fal image lost about $0.009 (2K) and $0.004 (4K).
--
-- Each update touches only a row that still holds its original seed from migration 011
-- (credits AND provider_cost_usd). An admin-edited price or cost is never overwritten.
-- Idempotent: a second run matches no row. Billing reads credit_amount (Option A), so the new
-- prices apply within the ~60 s pricing cache. provider_model_costs is unchanged.
-- After running, check (expect 11 / 0.12 and 15 / 0.16; anything else means an admin had edited it):
--   select pricing_key, credit_amount, provider_cost_usd from pricing_configs
--   where pricing_key in ('product_photo_nano_banana_2_2k_per_image', 'product_photo_nano_banana_2_4k_per_image')
--   order by pricing_key;

update pricing_configs
  set credit_amount = 11,
      provider_cost_usd = 0.12
  where pricing_key = 'product_photo_nano_banana_2_2k_per_image'
    and credit_amount = 10
    and provider_cost_usd = 0.101;

update pricing_configs
  set credit_amount = 15,
      provider_cost_usd = 0.16
  where pricing_key = 'product_photo_nano_banana_2_4k_per_image'
    and credit_amount = 14
    and provider_cost_usd = 0.151;
