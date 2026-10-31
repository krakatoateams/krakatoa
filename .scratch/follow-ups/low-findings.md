# Follow-up backlog: low findings

Collected 2026-10-31 from the reviews of the Fal provider, per-image settlement (#440–#452) and model
registry (#425–#429) work. None of these is urgent. Each item: what it is, why it matters, how likely it
is, and a suggested fix. "Likely" is a rough guess: rare = needs two unusual things at once.

## Money and generation

### 1. A failed partial refund is lost, but the message says it was refunded
- **What:** in a multi-image photo request, the route refunds images that definitely failed with one
  ledger write (key `refund:product_photo:{jobId}:partial`). That write is wrapped in the best-effort
  `safe()` helper, so if it fails it is only logged. The photo page still says "N were refunded".
- **Why it matters:** the user is told they got credits back when they did not. Nothing retries it.
- **How likely:** rare (the credit database call has to fail at exactly that moment).
- **Suggested fix:** have reconcile re-issue the same `:partial` key for batches whose per-image rows
  show `failed_definitive` without a matching ledger row (the key dedupes). Or only say "refunded"
  when the write succeeded.

### 2. Model resolver falls back to the code default when the database read fails
- **What:** `lib/model-resolver.ts` uses the code default provider model (`FALLBACKS`) when it cannot
  read `model_configs`.
- **Why it matters:** routing only. It can call the code-default provider model instead of an admin's
  chosen one during a database blip. It never re-enables a disabled or archived model (that check
  fails closed separately) and never changes the price.
- **How likely:** rare (database errors only).
- **Suggested fix:** acceptable as is. If it matters, fail closed with a retryable 503 like the model
  state read.

### 3. Per-image rows are written before the job is marked finished
- **What:** the route writes the per-image settlement rows, then calls `finishJob`. If `finishJob`
  fails, the job stays `running`. Reconcile only scans rows whose job is `succeeded`, so those rows
  are never looked at.
- **Why it matters:** the unclear images are never refunded or delivered late, and they don't appear
  in the manual-review query (`state = 'unresolved'`).
- **How likely:** rare (`finishJob` failing after a partly successful batch).
- **Suggested fix:** let the stale-job path move such jobs to `succeeded` when they have delivered
  rows. Or let the item scan accept a stale `running` job that has a `delivered` row. Or add the case
  to the manual-review query.

### 4. A row can stay "delivering" past the scan window
- **What:** since #452 a stored image that cannot be finalized goes to `unresolved` after 72 h. But if
  the Storage existence check keeps failing (or the run dies every time), the row stays `delivering`.
  After 72 h plus the 7-day band it leaves the scan.
- **Why it matters:** the row never reaches the manual-review query.
- **How likely:** very rare (days of Storage errors).
- **Suggested fix:** add `state = 'delivering' and updated_at < now() - interval '1 day'` to the
  monitoring or manual-review query (the runbook already lists it). Or let the expiry band move
  stale `delivering` rows to `unresolved`.

### 5. Late-delivery download has no size cap
- **What:** reconcile downloads the Fal output with a 15 s timeout, from the trusted `*.fal.media` host
  only, but does not cap the size.
- **Why it matters:** a huge file could use a lot of memory in the cron function.
- **How likely:** very unlikely (trusted host, normal image sizes).
- **Suggested fix:** check `content-length` and stop reading past a limit (e.g. 30 MB).

### 6. "It'll appear in your library" can be untrue
- **What:** the photo page tells users an unconfirmed image will appear if it finished. If Fal no
  longer keeps the result (retention for our requests is unverified live), late delivery can't fetch
  it, and the image goes to manual review instead.
- **Why it matters:** the user waits for an image that never comes, until support acts.
- **How likely:** depends on Fal retention. Unknown until the live check is done.
- **Suggested fix:** run the live checklist step (force one image to fail, run reconcile). If results
  expire quickly, soften the wording or store the payload longer.

### 7. Job cost snapshot is not lowered after a per-image refund
- **What:** when reconcile refunds one image, the job's `cost_credits` snapshot stays at the full
  amount.
- **Why it matters:** display only. The ledger (`credit_transactions`) is the source of truth and is
  correct.
- **How likely:** every per-image refund.
- **Suggested fix:** subtract the refunded credits from the snapshot, or label it "charged before
  refunds".

### 8. "Table missing" detection is based on error text
- **What:** `isMissingDbObject` decides that `generation_batch_items` does not exist by matching the
  error message.
- **Why it matters:** if Supabase/PostgREST changes the wording, a missing table could be reported as a
  normal error (the scan is then counted as an error, not skipped). It never causes a wrong refund.
- **How likely:** low (only after a Supabase upgrade that changes the message).
- **Suggested fix:** also match the error code (`PGRST205`, `42P01`) where the caller has it.

## Operations

### 9. cron-job.org free plan stops waiting after 30 seconds
- **What:** the reconcile cron can run longer than 30 s. cron-job.org then marks the run as failed even
  though it finished on Vercel.
- **Why it matters:** false "failed" alerts, which can hide a real failure.
- **How likely:** whenever a run is heavy.
- **Suggested fix:** keep the failure email on and check Vercel logs before acting. Or return early
  and finish in the background, or use a paid plan.

### 10. GitHub scheduled workflows are unreliable
- **What:** GitHub may delay or skip scheduled runs.
- **Why it matters:** it is only a backup trigger for reconcile; cron-job.org is primary.
- **How likely:** common under GitHub load.
- **Suggested fix:** none needed. Keep it as backup only.

### 11. Google Fonts download can fail CI (fixed in #458)
- **Status:** fixed. The app fonts are self-hosted in `app/fonts` with `next/font/local`; the build
  no longer downloads them.
- **What:** `next/font` downloads Google Fonts during the build, and that sometimes fails in CI.
- **Why it matters:** a red build that has nothing to do with the change.
- **How likely:** occasional.
- **Suggested fix:** rerun the failed job. Long term, self-host the fonts (`next/font/local`).

### 12. Vercel sometimes makes no production deploy for a merge
- **What:** merges of #448 (`d08c690`) and #452 (`dfd9c83`) produced no Vercel production deployment
  at all (not even a skipped one), while other merges deployed in about 3 minutes. They needed a manual
  `vercel deploy --prod` or a later merge. PR previews always show "Canceled by Ignored Build Step".
- **Why it matters:** merged fixes can sit undeployed without anyone noticing.
- **How likely:** happened twice on 2026-10-31.
- **Suggested fix:** check the project's Ignored Build Step setting and the Git integration in the
  Vercel dashboard. Add a post-merge check that fails when no production deployment appears for the
  merge commit within 10 minutes.

## Model registry (Admin Config → Models)

### 13. Impact preview counts without indexes
- **What:** the Remove dialog counts jobs, assets and usage events for a model with queries that have
  no supporting index.
- **Why it matters:** the dialog can get slow as tables grow.
- **How likely:** grows with data. Fine today.
- **Suggested fix:** add an index on the counted column, or show approximate counts.

### 14. Default-switch rollback is not compare-and-set
- **What:** making a feature model the default (`setFeatureDefaultSafely`, `lib/feature-default-switch.ts`)
  first sets the new default, then clears the old ones. If clearing fails, `revertTarget` puts the new
  row back without checking that nobody changed it in between.
- **Why it matters:** two admins editing defaults at the same moment could overwrite each other's change.
  If the rollback itself also fails, two defaults remain (the runtime then picks the first eligible one).
- **How likely:** rare (needs a database error and a second admin at the same time).
- **Suggested fix:** make the rollback compare-and-set on the `updated_at` the first write returned.

### 15. Reels engine list shows every engine while settings load
- **What:** `ReelsCreatorComposer` passes the composer settings to `filterReelsEngines`, and those
  settings are `null` until they load; `filterReelsEngines(…, null)` returns every engine.
- **Why it matters:** cosmetic. A disabled engine can flash in the list; the server still rejects it.
- **How likely:** on slow loads.
- **Suggested fix:** show a skeleton until the settings load.

### 16. No "undo migration" notes
- **What:** the registry migrations (117, 118) have no documented way back.
- **Why it matters:** a rollback would be improvised under pressure.
- **How likely:** rare (the migrations are additive).
- **Suggested fix:** add a short rollback note per migration in the runbook (the columns can simply
  stay).

## Unverified live

### 17. Fal result retention and billing of failed or cancelled runs
- **What:** how long Fal keeps results for our requests, and whether Fal bills runs that failed or were
  cancelled, have not been checked live.
- **Why it matters:** retention decides how often late delivery works. Billing decides our margin on
  refunded runs.
- **How likely:** unknown.
- **Suggested fix:** run the steps in `docs/generation/fal-provider-live-test-checklist.md` and record
  the answers in the runbook.

### 18. UI pieces never viewed in a browser
- **What:** these passed type and self-checks but no one has looked at them in a browser yet:
  - the Models view;
  - the Cost source column;
  - the provider dropdown;
  - the cancel messages.
- **Why it matters:** layout, wording or empty states may be off.
- **How likely:** some small issue is likely.
- **Suggested fix:** one manual pass on a preview deployment (desktop and phone width), with
  screenshots.
