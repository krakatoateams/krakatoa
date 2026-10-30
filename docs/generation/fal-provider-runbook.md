# Fal.ai provider runbook (Photo tiers)

Scope: the four Photo tiers that can run on Replicate (default) or Fal: Nano Banana (`image_basic`),
Nano Banana 2 (`image_balanced`), Nano Banana Pro (`image_pro`) and GPT Image 2.5 Flare
(`image_gpt_image_2`). Everything else (other photo tiers, video, motion control, reels, LLM, TTS)
is Replicate-only. Live verification steps: [`fal-provider-live-test-checklist.md`](fal-provider-live-test-checklist.md).

## How it works

- A tier's provider, model and parameters are ONE catalog unit (`lib/ai-provider-catalog.ts`,
  `lib/ai-providers/fal-photo-catalog.ts`). Admins pick a catalog pair, never raw params.
- The provider is recorded per prediction (`generation_predictions.provider`) at submit time.
  Cancel and status polling use the RECORDED provider, never the current config.
- Credit price per feature stays one `credit_amount`. Per-provider cost
  (`provider_model_costs`, migrations 115/116) is for margin and analytics only.
- Fal is treated as a provider commit at submit: a Fal cancel is only a request, so cancel locks
  and there is no refund after submit.
- Fal outputs must come from `*.fal.media` (HTTPS) and are copied to Storage under `{userId}/`.
- `FAL_KEY` is server-only. Without it Fal cannot be selected (admin save returns 400) or resolved
  (the resolver falls back to the code default, Replicate).

## Switch a tier to Fal

1. Make sure `FAL_KEY` is set in the deployment env and the deployment has been redeployed.
2. Admin → Config v2 → the tier's section → provider dropdown → Fal → save. Credit price does not change.
3. Wait up to 60 s (resolver cache TTL). In-flight jobs finish on the provider they started on.
4. Check (below).

## Roll back

Same dropdown → Replicate → save (or the tier's reset-to-default, which resets provider, model and
parameters together). Effective within 60 s. SQL fallback:

```sql
update model_configs set provider='replicate', model='<replicate model>' where tool_key='photo' and config_key='<config_key>';
```

Replicate models: `google/nano-banana`, `google/nano-banana-2`, `google/nano-banana-pro`,
`openai/gpt-image-2.5-flare`.

## Check after a switch

- Admin → Monitoring: new photo jobs show `fal` in the provider column; no red Fal banner.
- Generate one image on the tier (t2i and with a reference). Credits spent once; image in Storage.
- `generation_predictions.provider = 'fal'` for the new attempt.
- Fal dashboard: the call shows up and the cost is in line with `provider_model_costs`.

## Fal outage playbook

Signs: monitoring shows the amber "Fal jobs failed" banner, users report photo failures, Fal status
page. A failed Fal run refunds like any failed run.

1. Switch every Fal tier back to Replicate (above). This stops new traffic to Fal.
2. Leave in-flight jobs alone; they finish or fail and refund on their own.
3. After Fal recovers, switch one tier back and run the checklist before the rest.
4. There is no automatic fallback between providers (deliberately: backlog item).

## Balance and concurrency

- Alerts: the monitoring page shows a red banner when failed Fal jobs carry a balance error
  ("exhausted balance", "account locked"). Fal has no balance webhook we use, so also set a billing
  alert and auto top-up in the Fal dashboard (Billing). Top up, then retest one generation.
- Concurrency: new Fal accounts are limited to 2 concurrent requests; extra requests queue (Fal
  does not return 429). Check the account's tier in the Fal dashboard before switching a busy tier.
  Queued time counts against the route's `maxDuration` (300 s).
- Deadline: the Fal adapter has no deadline of its own. The wait is bounded by the route's
  `maxDuration`; a run that outlasts it fails the request and is refunded by the stuck-run reconcile
  cron. Do not add a shorter adapter timeout without a policy for runs that still finish and bill.

## Cost approximation

Fal bills GPT Image 2.5 Flare by tokens, so cost varies with size and reference count. Migration 116
has text-to-image rows only (keyed to the t2i endpoint, 1024x1024). Edit calls (with references)
cost more: roughly $0.014 / $0.022 / $0.061 for low / medium / high plus about $0.008-0.012 per
reference. Margin figures for GPT on Fal are therefore approximate; they never affect what users pay.

## Observed behavior (fill in during the live run)

| Fact | Observed |
|---|---|
| Cancel billing (cancel mid-run, is the run billed?) | _not yet observed_ |
| Concurrency limit of our account | _not yet observed_ |
| Output host of real results | _not yet observed (expected `*.fal.media`)_ |
| Signed Supabase URLs accepted as inputs | _not yet observed_ |

## Backlog (separate issues)

- GPT Image 2.5 Flare `xhigh` / `max` quality: needs new pricing keys and a picker change.
- Other models, video, motion control, reels on Fal: needs a Fal webhook (ED25519 over
  `request_id\nuser_id\ntimestamp\nsha256hex(body)`, JWKS `https://rest.fal.ai/.well-known/jwks.json`,
  ±300 s window, retries without dedup) plus a submission fence.
- Provider fallback: definitive failures only, same model on the other provider.
