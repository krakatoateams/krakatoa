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
  (`cancel_allowed=false`) and a cancel after submit is rejected.
- Refund policy after submit (one place: `shouldRefundSpentCreditsAfterFailure` in
  `lib/generation-commit-pure.ts`): a DEFINITIVE Fal failure refunds exactly once (Fal queue status
  `COMPLETED` with `error`, or `queue.result()` throws a Fal `ApiError`). An AMBIGUOUS outcome (timeout
  past `maxDuration`, network loss, abort after submit) does not refund; the attempt stays locked
  and the reconcile cron refunds it only if Fal confirms every recorded request failed. The route
  settles such a job `failed` with code `PROVIDER_OUTCOME_UNKNOWN` (user sees "we're re-checking it
  for a few days; credits are returned automatically once the provider confirms the run failed", not
  a refund claim). The reconcile cron (`/api/cron/generation-reconcile`, ONCE A DAY at 05:00 UTC,
  `vercel.json`) re-checks those jobs: window = `updated_at` in (now-72 h, now-5 min)
  (`SETTLED_LOOKBACK_MS`), so a job gets about three daily attempts and a job that failed minutes
  before a run is picked up by the next one. The scan is keyset-paged (`updated_at`, `id` ascending,
  50 per page) over ALL candidates, 4 jobs in parallel, each Fal check capped at 15 s, and stops
  starting new batches after 45 s (`SETTLED_BUDGET_MS`; route `maxDuration` is 120 s); anything left is
  counted in the run's `settledLeft` log/response and handled next run. Refunds use the route's own
  idempotency key (`refund:product_photo:{jobId}`) plus a `hasRefundForJob` check, so route + reconcile
  + overlapping runs can never double refund. Reconcile confirms failure via queue status `COMPLETED` +
  `error`, or, when status has no `error`, a `result()` 4xx ApiError. An ApiError 5xx/408/429, timeout or
  network loss is AMBIGUOUS in reconcile (no refund; the route's own rule is unchanged).
  **After 72 h** (a 7-day band beyond the window is still visited): reconcile makes one last confirm
  attempt; if Fal still does not confirm failure the job is rewritten to code
  `PROVIDER_OUTCOME_UNRESOLVED` (user sees "…credits were not returned automatically. Contact support…";
  monitoring shows a red "Unresolved, needs manual review" banner and `unresolved` in the cron log).
  Manual resolution (no admin UI exists for refunding a user job; `/api/admin/credits/*` only touches
  admin wallets): check the Fal dashboard for the request; only if the run failed, a developer calls
  `refundCredits({ profileId, amount, jobId, idempotencyKey: "refund:product_photo:{jobId}", ... })`
  (RPC `krakatoa_apply_credit_transaction`, type `refund`) with that SAME key so a late route/reconcile
  refund cannot double it. Never refund a run that produced output.
  Cadence: if a daily check is too slow after an outage, a more frequent cron is the lever (needs plan
  support for sub-daily crons; not changed here).
  Known limitation (batches, no per-image tracking): a Fal batch of several images where every image
  failed but only some definitively is partial-refunded by the route and tagged `UNKNOWN`; reconcile
  skips it because a refund already exists, so the ambiguous remainder is never revisited. A batch with
  some images saved and some ambiguous failures is `succeeded`, so reconcile never sees it. Both need
  per-image outcome records and per-image refund keys (schema change) and are left for a follow-up.
  A run that produced output is never refunded. Batch partial refunds follow the same rule per image.
- Unverified: whether Fal bills failed runs. Fal's docs describe failed requests (status `COMPLETED`
  + `error`/`error_type`) but do not say whether they are billed. Check the Fal billing dashboard
  after a failed run and record the answer here.
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
update model_configs set provider='replicate', model='<replicate model>', parameters='{}' where tool_key='photo' and config_key='<config_key>';
```

Migrations: 113-117 are ALL applied in prod as of 2026-10-31. 113-114 (`provider` columns for model config and
`generation_predictions`) are required; 115-117 (Fal Nano Banana cost rows, Fal GPT Flare cost rows, admin config
audit log) are optional and now applied. The app tolerates their absence in other environments (margin figures stay
unknown, config audit rows are skipped). Check what an environment has: `select provider from model_configs limit 1`
(113), `select count(*) from provider_model_costs` (115/116), `select count(*) from admin_config_audit_log` (117),
or compare `supabase/migrations/` against the environment's applied list.

Replicate models: `google/nano-banana`, `google/nano-banana-2`, `google/nano-banana-pro`,
`openai/gpt-image-2.5-flare`.

## Check after a switch

- Admin → Monitoring: new photo jobs show `fal` in the provider column; no red Fal banner.
- Generate one image on the tier (t2i and with a reference). Credits spent once; image in Storage.
- `generation_predictions.provider = 'fal'` for the new attempt.
- Fal dashboard: the call shows up and the cost is in line with `provider_model_costs`.

## Fal outage playbook

Signs: monitoring shows the amber "Fal jobs failed" banner, users report photo failures, Fal status
page. A definitive Fal failure refunds; an ambiguous one (timeout, network loss) is held for reconcile (see Refund policy above).

1. Switch every Fal tier back to Replicate (above). This stops new traffic to Fal.
2. Leave in-flight jobs alone; definitive failures refund on their own, ambiguous ones are held and refunded by reconcile (daily, 72 h window) only if Fal confirms the failure; after that they are marked unresolved for manual review.
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
  `maxDuration`; a run that outlasts it fails the request with an ambiguous outcome. The reconcile
  cron refunds it only if Fal's queue status then reports failure; a run that finished is not refunded. Do not add a shorter adapter timeout without a policy for runs that still finish and bill.

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
| Output host of real results | `*.fal.media` (2026-10-31) |
| Signed Supabase URLs accepted as inputs | yes (2026-10-31) |

## Verified live (2026-10-31)

Nano Banana (basic) on Fal WITH a reference image, in prod, end to end:

- Endpoint `fal-ai/nano-banana/edit` was selected because of the reference image.
- Fal billed 0.0398 USD, matching `provider_model_costs`.
- A Supabase signed URL worked as a Fal input.
- The output passed the `*.fal.media` host allowlist and was copied to Storage under `{userId}/...` with the
  `MEDIA_CACHE_CONTROL` header.
- One spend of 4 credits, no refund; `usage_events.provider = 'fal'`.
- `admin_config_audit_log` recorded `provider_switch` rows; anon REST reads of that table and of
  `provider_model_costs` return nothing (RLS verified).

Still NOT verified live: other tiers on Fal, the text-to-image endpoint, GPT Flare on Fal (including 16:9 / 9:16),
failure behavior and Fal billing of failed runs, cancel behavior.

## Backlog (separate issues)

- GPT Image 2.5 Flare `xhigh` / `max` quality: needs new pricing keys and a picker change.
- Other models, video, motion control, reels on Fal: needs a Fal webhook (ED25519 over
  `request_id\nuser_id\ntimestamp\nsha256hex(body)`, JWKS `https://rest.fal.ai/.well-known/jwks.json`,
  ±300 s window, retries without dedup) plus a submission fence.
- Provider fallback: definitive failures only, same model on the other provider.
