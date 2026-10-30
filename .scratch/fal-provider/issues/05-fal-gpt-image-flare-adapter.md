# Run GPT Image 2.5 Flare photos on fal.ai

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/397
Blocked by: 04

## Overview

The GPT Image 2.5 Flare photo option can also run on the second AI provider, fal.ai. Users get the same options and the same price whichever provider the team picks; only the team's behind-the-scenes cost differs.

## Implementation Requirements

- Catalog entries for Flare on Fal: `openai/gpt-image-2.5/flare/text-to-image` and `openai/gpt-image-2.5/flare/edit`.
- Fal has no `aspect_ratio` for this model: map the tier's aspect ratio to `image_size` (presets `square_hd`, `square`, `portrait_4_3`, `portrait_16_9`, `landscape_4_3`, `landscape_16_9`, or `{width,height}`). Presets cover 1:1, 4:3, 3:4, 16:9, 9:16 only; 3:2 and 2:3 need custom sizes (multiples of 16, max edge 3840, ratio ≤ 3:1, 655,360–8,294,400 px). Pick fixed sizes per ratio so cost stays predictable; the existing 4:5 / 21:9 clamp may stay (untested whether Fal accepts them as custom sizes).
- Always send `quality` explicitly (Fal default is `high`, not medium); allowed in v1: low/medium/high.
- Field mapping: `input_images` → `image_urls` (edit max 16; keep repo cap lower), `number_of_images` → `num_images` (send 1), drop `moderation`, keep `background: "opaque"` and `output_format: "png"`.
- Cost: token-based on Fal, varies with size and references. Store an approximate flat per-quality provider cost in the phase 3 cost table for margin display only; user credits stay unchanged (2/5/12 per phase 1).
- Reuse the phase 4 Fal client, output host guard, input-file strategy and billing/commit rules unchanged.

## Technical Notes

- Verified in repo: tier `gpt_image_2` in `lib/product-photo.ts` and the gpt_image builder case (after phase 1 it targets Flare).
- Fal figures (vendor docs, measured 2026-09-08, NOT live-verified by us): 1024² text-to-image about $0.0060 low / $0.0133 medium / $0.0528 high; edit about $0.0142 / $0.0215 / $0.0610; each reference adds roughly $0.008–0.012. xhigh/max only on a vendor blog (≈$0.094 / ≈$0.211 at 1024²), edit-side unknown, so they remain out of scope.
- `num_images` limit is documented inconsistently (1–10 vs up to 4); we send 1.

## Acceptance Criteria

- With a DB-set `fal` pair: every picker ratio produces an image of the expected shape for t2i and with references; quality maps correctly; credits identical to Replicate.
- Size mapping covered by a self-check (all picker ratios → valid `image_size`, constraints satisfied).
- `npm run ci:checks`, adapter self-checks, lint, build pass. Default stays Replicate; rollback = config back to replicate.

## Comments
