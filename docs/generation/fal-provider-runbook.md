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
- Fal cancel is best-effort, see "Photo cancel on Fal" below: submit is NOT a commit while the request is queued;
  the attempt locks (`cancel_allowed=false`) when Fal reports IN_PROGRESS, the status is ambiguous, a cancel is not
  confirmed, or output arrives.
- Refund policy after submit (one place: `shouldRefundSpentCreditsAfterFailure` in
  `lib/generation-commit-pure.ts`): a DEFINITIVE Fal failure refunds exactly once (Fal queue status
  `COMPLETED` with `error`, or `queue.result()` throws a Fal `ApiError`). An AMBIGUOUS outcome (timeout
  past `maxDuration`, network loss, abort after submit) does not refund; the attempt stays locked
  and the reconcile cron refunds it only if Fal confirms every recorded request failed. The route
  settles such a job `failed` with code `PROVIDER_OUTCOME_UNKNOWN` (user sees "we're re-checking it
  for a few days; credits are returned automatically once the provider confirms the run failed", not
  a refund claim). The reconcile cron (`/api/cron/generation-reconcile`) re-checks those jobs every ~10 minutes
  (GitHub Actions workflow `.github/workflows/generation-reconcile.yml`; the daily 05:00 UTC Vercel cron in
  `vercel.json` stays as a backup): window = `updated_at` in (now-72 h, now-5 min)
  (`SETTLED_LOOKBACK_MS`), so a job failed minutes before a run is picked up by the next one (Fal keeps
  results about 1 hour, so the refund normally lands within ~15 minutes; later attempts mostly cannot
  confirm and the job turns `unresolved` after the window). The scan is keyset-paged (`updated_at`, `id` ascending,
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
  Cadence: every ~10 minutes via GitHub Actions (no Vercel plan upgrade needed); see "Reconcile schedule" below.
  Batches with 0 delivered images: the route's `settleZeroSuccessBatch` is order independent. A definitive
  failure mixed with confirmed-cancelled (removed) images refunds the whole spend once; an ambiguous
  image keeps the job `UNKNOWN` (the removed/definitive images are refunded by the route with the
  `:partial` key). Reconcile then refunds only the REMAINDER (spend minus refunds so far, valid because a
  failed job delivered nothing) under `refund:product_photo:{jobId}:remainder`, only when Fal reports every
  prediction failed (a cancelled request Fal no longer knows, status 404, keeps it unconfirmed: manual review).
  Known limit (S2): a batch with some images saved and some ambiguous failures is `succeeded`, so reconcile
  never sees it and the user stays charged for the undelivered image; fixing it needs per-image outcome
  records and refund keys (schema change), left for a follow-up decision.
  Expired results: reconcile treats a 404 on `result()` as ambiguous (the run may have delivered), never as failed.
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
2. Leave in-flight jobs alone; definitive failures refund on their own, ambiguous ones are held and refunded by reconcile (every ~10 min, 72 h window) only if Fal confirms the failure; after that they are marked unresolved for manual review.
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

## Photo cancel on Fal (best-effort, #421)

### Fal facts (read from Fal's official docs and OpenAPI on 2026-10-31; nothing here was exercised live)

Sources: [Queue docs](https://fal.ai/docs/model-apis/model-endpoints/queue) and the
[queue OpenAPI](https://fal.ai/docs/api-reference/inference-api/openapi/queue.json).

| Item | Status |
|---|---|
| `PUT https://queue.fal.run/{owner}/{app}/requests/{id}/cancel` on a request IN_QUEUE: HTTP 200 `{"status":"OK"}`, "fal removed it, and it does not run" | VERIFIED (docs) |
| Cancel on IN_PROGRESS: HTTP 202 `{"status":"CANCELLATION_REQUESTED"}`, a signal to the runner, "the request can still complete" | VERIFIED (docs) |
| Cancel on a finished request: HTTP 400 `{"status":"ALREADY_COMPLETED"}`; unknown id or other account: 404 `NOT_FOUND` | VERIFIED (docs) |
| Queue status values `IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`; "A failed or cancelled request also has the status COMPLETED" (no distinct cancelled status) | VERIFIED (OpenAPI) |
| Result of a cancelled request: HTTP 499 "The request was cancelled" (only in the OpenAPI, not on the Queue page) | VERIFIED (OpenAPI), UNVERIFIED live |
| What the status endpoint returns right after a queued request was removed (still IN_QUEUE? COMPLETED? 404?) | UNVERIFIED (not documented) |
| Whether a cancelled request is billed | UNVERIFIED (not documented; the Serverless pricing page was not read) |
| `@fal-ai/client` 1.10.1 `queue.cancel()` returns `Promise<void>`: it discards the body, succeeds on 200/202 and throws `ApiError` on 400/404 | VERIFIED (client source, docs). 200 vs 202 cannot be told apart through the client |

Consequences: our adapter reads the raw cancel answer through a capturing `fetch` (`createFalPhotoProvider`), treats ONLY
200 `OK` as a removal, and still requires a follow-up read that shows no output before refunding. Everything unverified
is designed for the worst case: a cancel that is not honored behaves like before (run completes, user charged) plus a
message.

### Definition of "commit" for Fal

Submit is NOT a commit while the request is queued. The attempt commits (`cancel_allowed=false`) when Fal reports
`IN_PROGRESS`, when a status read fails (ambiguous), when a cancel is not confirmed (202, 400, error, unknown, or an
output exists after a 200), or on COMPLETED/any output. `PhotoProvider.cancelWhileQueued` (Fal true, Replicate false)
says the adapter owns cancel and the lock timing. `commitsOnSubmit` keeps only its settlement meaning: a failure after
submit is ambiguous, so only a definitive Fal failure refunds (`shouldRefundFailedBatchImage`, reconcile,
`settlement-pure`, unchanged #411-#416 policy). Replicate behavior is unchanged.

### State machine (per attempt, one `generation_requests` row)

```
QUEUED (cancel_allowed=true)
  -- user Cancel (requestCancel: sets cancel_requested only where cancel_allowed) --> CANCEL_REQUESTED
  -- poll sees IN_PROGRESS / COMPLETED / status error (lock CAS: cancel_allowed=false only where
     NOT cancel_requested) --> COMMITTED
CANCEL_REQUESTED  (the generate route polls; the adapter is the ONLY caller of Fal cancel)
  -- Fal 200 OK + follow-up shows no output --> CANCELLED_CONFIRMED: GenerationCancelledError, the route refunds the
     spend once (stable `refund:product_photo:{jobId}`), job `cancelled`, no asset
  -- 202 / 400 / error / unknown / output exists anyway --> COMMITTED (markProviderCommitted clears cancel_requested)
COMMITTED --> DELIVERED (charged once) | FAILED_DEFINITIVE (refund via shouldRefundSpentCreditsAfterFailure)
           | FAILED_AMBIGUOUS (stays locked, PROVIDER_OUTCOME_UNKNOWN, reconcile every ~10 min)
```

- The cancel-vs-commit race is decided by one atomic statement each (`requestCancel` and
  `lockProviderUnlessCancelRequested`, mirrored by the pure `casRequestCancel` / `casLockUnlessCancelRequested`). First
  writer wins: a cancel after the lock gets 409 `CANCEL_NOT_ALLOWED`; a lock attempt after a cancel fails and the route
  follows the cancel outcome. No migration or RPC is involved.
- The cancel endpoint never refunds and never calls Fal for the legacy photo path (it skips provider `fal`); a second
  click returns `already_cancelling` with no second Fal call.
- Never both refund and deliver; never charge without delivering (except ambiguous, which reconcile settles).
- Batch (`imageCount > 1`): one request-level lock. Any image leaving the queue locks the whole request (cancel is
  409, all images are charged). Cancel while every image is queued cancels all and refunds the whole spend once. If the
  cancel races an image that just started, that image commits and delivers; the images Fal already removed are refunded
  per image (`planBatchFailures`), so the user is never charged for a missing image.
- A cancel the API accepted but Fal could not confirm (202 / unconfirmed): the image arrives, the user is charged,
  and the form or canvas node shows the same refused message ("... Credits are used.") when it lands.
- Known limits (not fixed): (L1) if the generate route is killed while a request is still `IN_QUEUE`, nobody cancels
  it at Fal; (L4) `abortCheck` fails closed on a DB error (the request is treated as committed); (L5) in a raced batch
  the removed image is refunded as a partial refund (money correct, not the cancel path).
- Trace: every attempt is kept as a finished job step (admin job timeline): `cancel_requested`, `cancel_refused`
  (reason `committed` / `raced_with_commit`) from the cancel endpoint, and `cancel_outcome` (`result`, `confirmed`,
  Fal status) from the generate route, plus a log line. No new column.
- UI: a 409 `CANCEL_NOT_ALLOWED` shows "Generation already started and can't be cancelled. Credits are used." in the
  form's error banner and the button becomes "Finalizing…" at once; other cancel failures show "Couldn't cancel. Please
  try again."

### Live test steps for the cancel (run by hand, record results in the table below)

1. Queued cancel: submit a Photo job and press Cancel within the first second or two (before Fal reports IN_PROGRESS;
   a busy model or a batch of 4 helps). Expect: job `cancelled`, credits refunded once, no asset, `cancel_outcome` step
   with `result: removed, confirmed: true`. Record what Fal's status/result returned afterwards and whether Fal billed.
2. Running cancel: press Cancel after the job is processing. Expect: the notice, "Finalizing…", the image arrives,
   one spend and no refund, `cancel_refused` step. Check Fal usage to see whether the run was billed (normal).
3. Race: spam Cancel around the moment the run starts. Expect exactly one of: refund and no image, or image and charge;
   never both and never neither. Look at the job's `cancel_*` steps and the credit ledger.
4. Batch of 2+ images: cancel while queued (full refund) and after one started (409, charged for all).

## Observed behavior (fill in during the live run)

| Fact | Observed |
|---|---|
| Cancel billing (cancel mid-run, is the run billed?) | _not yet observed_ (see "Photo cancel on Fal", live tests 2 and 3) |
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

Broader prod evidence (2026-10-31, read-only DB check): 7 Fal photo jobs in 3 hours, ALL succeeded, 0 failed or stuck,
no `PROVIDER_OUTCOME_*` codes.

- Tiers covered: Nano Banana (4 credits), Nano Banana 2 (7), Nano Banana Pro (14), GPT Image 2.5 Flare (12 credits at
  high, 2 at low), including one 16:9 GPT job.
- Runs were done with and without a reference image, per the tester (no per-job endpoint split claimed).
- Exactly one spend per job, no refunds. Fal latency 18-43 s.
- (Historical, before #421) Cancel after Fal submit returned 409 `CANCEL_NOT_ALLOWED` because `cancel_allowed=false`
  was set at submit, and the click was silently ignored in the UI. Superseded by "Photo cancel on Fal".
- `assets.file_size_bytes` / `width` / `height` are NULL for ALL photo assets on both providers (normal; nothing reads
  them for photos).

Still NOT verified live:

- Failure behavior, and whether Fal bills failed runs.
- GPT 9:16 and other explicit sizes (only 16:9 seen).
- Nano Banana 2 / Pro resolutions other than the one used (resolution coverage not itemized).
- Cancel billing on Fal.

Known gap: the margin dashboard does not yet use `provider_model_costs` (planned fix).

## Backlog (separate issues)

- GPT Image 2.5 Flare `xhigh` / `max` quality: needs new pricing keys and a picker change.
- Other models, video, motion control, reels on Fal: needs a Fal webhook (ED25519 over
  `request_id\nuser_id\ntimestamp\nsha256hex(body)`, JWKS `https://rest.fal.ai/.well-known/jwks.json`,
  ±300 s window, retries without dedup) plus a submission fence.
- Provider fallback: definitive failures only, same model on the other provider.

Adding a new model (ship dark, then add in Admin Config): [`docs/admin/adding-a-generation-model.md`](../admin/adding-a-generation-model.md).

## Reconcile schedule (every ~10 minutes)

The workflow `.github/workflows/generation-reconcile.yml` calls `GET /api/cron/generation-reconcile` with
`Authorization: Bearer <CRON_SECRET>` every 10 minutes (GitHub scheduled runs are best-effort and may start a few
minutes late). The route still fails closed without `CRON_SECRET`. It is safe to run often:

- Idempotent: refunds use stable keys (`refund:product_photo:{jobId}`, `refund:reconcile:{jobId}`) plus
  `hasRefundForJob`/refunded-amount checks, so overlapping runs (Actions, the daily Vercel backup, a manual run)
  cannot double refund.
- Bounded: 4 Fal checks in parallel, each capped at 15 s, 45 s time budget per scan, leftovers wait for the next
  run; the workflow uses `curl --max-time 115` (route `maxDuration` is 120 s), no retries, and a concurrency
  group so two Actions runs never overlap.
- Cheap when idle: with no held jobs a run is a few small queries.
- Known cost: a held job unconfirmed after Fal drops its result (~1 h) is re-checked each run until the 72 h window
  ends, then marked `unresolved`. This is bounded by the caps above; held jobs are rare.

**One-time setup (needed once, by someone with repo admin access):**

1. Open the GitHub repo, then Settings, then Secrets and variables, then Actions.
2. Tab "Secrets" -> New repository secret. Name: `RECONCILE_CRON_SECRET`. Value: the same value as `CRON_SECRET` in Vercel (Project Settings -> Environment Variables -> Production).
3. Tab "Variables" -> New repository variable. Name: `PROD_BASE_URL`. Value: the production site address starting with `https://`, no slash at the end.
4. Test: Actions tab -> "Generation reconcile" -> Run workflow (branch main). A green run whose log shows JSON with `refunded`/`staleJobs` counts means it works. A green run saying "Skipped" means the secret or variable is missing.

Until both exist the workflow skips (green) and only the daily Vercel cron runs. **Turn off:** Actions tab ->
"Generation reconcile" -> "..." -> Disable workflow (or delete the `PROD_BASE_URL` variable).
