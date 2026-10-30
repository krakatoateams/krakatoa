# Run the three Nano Banana photo options on fal.ai

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/396
Blocked by: 03

## Overview

The three Nano Banana photo options can now run on a second AI provider, fal.ai, as an alternative to the current one. By default nothing changes and everything keeps running on the current provider; the new provider is only used once the team deliberately switches a model to it.

## Implementation Requirements

- Add a Fal client (`@fal-ai/client`, server-side only; do NOT use `@fal-ai/server-proxy`) and a Fal adapter behind the phase 2 seam using `fal.subscribe` (queue + polling). The photo path is in-request, so no Fal webhook is needed; webhooks are deferred to later phases (motion control/reels).
- Catalog entries (phase 3 catalog) for Nano Banana (`basic`), Nano Banana 2 (`balanced`), Nano Banana Pro (`pro`) on Fal, each with: text-to-image and edit endpoint ids, input mapping, output normalizer, trusted output hosts, per-resolution cost.
- Endpoint choice by presence of reference images: `fal-ai/nano-banana[/edit]`, `fal-ai/nano-banana-2[/edit]`, `fal-ai/nano-banana-pro[/edit]`.
- Field mapping: `image_input`/`input_images` → `image_urls`; `number_of_images` → `num_images`; drop `allow_fallback_model` (Pro); NB2 `google_search`/`image_search` → `enable_web_search`/`enable_image_search` or omit (defaults false). Keep `aspect_ratio`, `resolution` (1K/2K/4K), `output_format`.
- Output: parse `images[0].url`. Add a per-provider trusted-host allowlist (SSRF guard); today `assertTrustedReplicateOutputUrl` allows only `replicate.delivery`. Copy Fal media to Storage promptly under `{userId}/...` with `MEDIA_CACHE_CONTROL` (Fal URLs are public and unauthenticated).
- Input files: replace `uploadProductImageToReplicate` for Fal with a strategy that yields URLs Fal can fetch (Supabase signed URLs with TTL longer than queue wait, or Fal storage upload). Owner-scope lookup before signing. Include a live smoke test that Supabase signed URLs work as Fal inputs (UNVERIFIED).
- Secrets: add `FAL_KEY` to `lib/client-secret-boundary-self-check.ts` (~line 254) and to the "is not set/configured" patterns in `lib/generation-log-redaction-self-check.ts`; never expose to the client.
- Billing contract unchanged: spend before the provider call; treat a Fal submit as a provider commit (`cancel_allowed=false`, no refund after commit) unless Fal confirms cancel billing. Fal cancel returns `CANCELLATION_REQUESTED` and the run may still complete; billing of cancelled runs is undocumented.
- Record `provider='fal'` on predictions/submissions (phase 3) and keep catalog-level cost for margin only.
- The admin UI does not offer Fal yet (phase 6); switching is possible only by a DB edit validated by the catalog. Default stays Replicate.

## Technical Notes

- Verified in repo: `buildPhotoProviderInput` (`lib/product-photo.ts` ~801), nano families `nano_basic/nano_balanced/nano_pro`; route imports listed in phase 2.
- Fal facts from vendor docs, NOT independently verified by a live call: Nano prices NB $0.0398/img; NB2 0.5K $0.06 / 1K $0.08 / 2K $0.12 / 4K $0.16; NB Pro 1K $0.15, 2K $0.15 (single source, confirm), 4K $0.30. NB (basic) has no resolution. Aspect ratios cover the repo's 9. Reference caps: NB2/Pro total 14; NB basic unknown, keep repo caps below documented limits. New Fal accounts allow 2 concurrent requests (queued beyond); check the account tier before switching production traffic. Fal queue does not return 429.
- Pricing keys per tier/resolution already exist (`product_photo_nano_banana_*`); only provider-specific cost rows are added.

## Acceptance Criteria

- With config on Replicate: zero behavior change. With a DB-set `fal` pair for each of the 3 tiers: t2i and with-reference generations succeed, image lands in Storage with correct path/cache headers, credits and refunds match Replicate behavior.
- Fal outputs from non-allowlisted hosts are rejected.
- Mixed-provider cancel works through the recorded provider.
- `npm run ci:checks`, `test:client-secret-boundary`, `test:generation-log-redaction`, new adapter self-checks (mapping, endpoint choice, output normalization, host guard), lint and build pass. Rollback: set config back to replicate.

## Comments
