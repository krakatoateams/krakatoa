# Let users really cancel a photo generation on fal.ai (best-effort), and tell them when they cannot

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/421
Blocked by: none

## Overview

Right now a user who presses Cancel on a photo that is being made by one of our AI partners often cannot stop it, and the button just quietly does nothing. After this change, if the request has not started running yet, Cancel really stops it and the credits come back. If it has already started, the user sees a clear message that it can't be cancelled and the credits are used, and the photo still arrives.

## Implementation Requirements

### 0. Research step (do first, record in `docs/generation/fal-provider-runbook.md` with source links)

From Fal's official docs and OpenAPI (queue API: `https://docs.fal.ai/model-apis/model-endpoints/queue`, queue OpenAPI/`PUT .../requests/{request_id}/cancel`, and the `@fal-ai/client` source) verify and write down, marking each item VERIFIED (with link) or UNVERIFIED:
- What queue cancel does per state: IN_QUEUE vs IN_PROGRESS vs COMPLETED; the exact response/status values (candidates seen so far, all UNVERIFIED by us: `CANCELLATION_REQUESTED`, `ALREADY_COMPLETED`; HTTP codes) and exact queue status values (`IN_QUEUE`, `IN_PROGRESS`, `COMPLETED`, whether a cancelled request ever reports a distinct status).
- Whether a cancelled request is billed (undocumented so far).
- What `@fal-ai/client` `queue.cancel` returns today (currently typed `Promise<void>`; the response body may be discarded, which would hide the confirmation we need).
- Optionally confirm live with a throwaway request on the real account (queued vs running), recording observed results.
**Anything unverified: design for the worst case (cancel not honored, cancel acknowledged but the run still completes and bills).** Refund only on positive confirmation.

### 1. Policy and definition of "commit" for Fal

CLAUDE.md contract "`cancel_allowed=false` after provider commit" stays; define commit precisely for Fal: **submit is NOT a commit while the request is queued. Commit happens when Fal reports IN_PROGRESS, when status is unknown or ambiguous, when cancel was not confirmed, or on any terminal output.** Replicate keeps today's behavior (its provider has `commitsOnSubmit=false`; do not change it). Update the `commitsOnSubmit` doc/semantics accordingly (consider replacing it with an explicit capability such as `cancelWhileQueued`) and keep `shouldRefundFailedBatchImage`, `shouldRefundSpentCreditsAfterFailure`, `lib/generation-reconcile.ts` (`confirmDefinitiveFailure` uses `commitsOnSubmit`) and `lib/metered-generation/settlement-pure.ts` consistent (definitive failure refund; ambiguous stays locked → `PROVIDER_OUTCOME_UNKNOWN`/daily reconcile) per #411/#413/#415.

### 2. Behavior

- While status is `IN_QUEUE`: `cancel_allowed` stays true; the cancel endpoint sets `cancel_requested` as today; the **generate route** (owns in-flight refunds; the cancel endpoint must NOT refund) calls Fal queue cancel from its poll loop (`abortCheck` → `fal.queue.cancel`), and only if Fal **confirms** the cancel (verified response value, and confirmed by a follow-up status/result check) does it throw `GenerationCancelledError`, so the existing `isRefundableUserCancellation` path refunds the spend (stable key) and the job ends `cancelled` with no image/asset.
- On the first poll that returns `IN_PROGRESS` (or any status other than IN_QUEUE, or a status read failure): atomically lock (`cancel_allowed=false`, `provider_committed_at`) — a compare-and-set that fails if `cancel_requested` was already set and a cancel is in flight (see state machine). After the lock a cancel POST returns 409 `{code:"CANCEL_NOT_ALLOWED", cancelAllowed:false}` and the run completes, the user is charged, the image delivered.
- Cancel not confirmed (Fal says it cannot cancel, error, or response unknown): treat as committed: lock, clear `cancel_requested`, let the run finish, charge, deliver.
- Multi-image batches (`imageCount > 1`, several predictions, one request-level lock): define explicit behavior. Simplest safe rule: request-level lock when ANY prediction leaves the queue; cancel while all still queued cancels all and refunds the full spend; if some were already running, refuse cancel (409) and charge all. Never partially cancel.
- UI: in `lib/use-idempotent-submit.ts` `cancel()`: on 409 `CANCEL_NOT_ALLOWED` show an English toast, e.g. "Generation already started and can't be cancelled; credits are used." and set the cancel button to "Finalizing…" immediately; for any other failed cancel (non-OK, network error) also show a toast (e.g. "Couldn't cancel. Please try again.") instead of silently resetting. No toast library exists in the repo today (verify with grep); use the existing notification pattern if one is found, else add the smallest accessible inline/toast mechanism. English only. Do not change the "Finalizing…" swap in `GenerationCancelButton`.
- Trace: record every cancel attempt and its outcome (requested, confirmed, refused, raced) durably, since `markProviderCommitted` clears `cancel_requested` and the 409 is not logged today. Prefer an additive column/JSON on `generation_requests` or the existing prediction/step records (idempotent additive migration if needed; follow `supabase/migrations/` conventions; update `npm run db:setup` only if needed). Surface in admin monitoring (`app/(app)/admin/monitoring/page.tsx` already shows cancel_allowed).

### 3. State machine (must be written into the runbook and implemented with the real settlement functions)

States per attempt: `QUEUED` (cancel_allowed=true) → `CANCEL_REQUESTED` → {`CANCELLED_CONFIRMED` (refund once, no image) | `COMMITTED` (cancel refused/unconfirmed/raced)}; `QUEUED` → `COMMITTED` (IN_PROGRESS/ambiguous) → `DELIVERED` (charged once) | `FAILED_DEFINITIVE` (refund via `shouldRefundSpentCreditsAfterFailure`) | `FAILED_AMBIGUOUS` (stays locked, `PROVIDER_OUTCOME_UNKNOWN`, reconcile). Required invariants:
1. Never both refund and deliver an image; never charge without delivering (except ambiguous → reconcile, existing policy).
2. The cancel-vs-commit race is decided by ONE atomic DB compare-and-set (cancel_requested vs cancel_allowed; `requestCancel` sets `cancel_requested` only `where cancel_allowed`; the lock only where not `cancel_requested`, otherwise it waits for the cancel outcome). Winner is the first writer; loser follows the winner's outcome.
3. Completion observed after a "confirmed" cancel (Fal says CANCELLATION_REQUESTED but the result arrives) → COMMITTED path: deliver and charge, no refund; refund only when status/result positively shows no output.
4. Spend/refund idempotency keys unchanged (`refund:product_photo:{jobId}:...` etc.); double cancel is idempotent (second returns `already_cancelling`/409 without a second Fal call or refund).
5. Cancel endpoint never refunds; HTTP 202 stays non-terminal and keeps the attempt locked until polling returns an explicit terminal status.

## Technical Notes (verified in code)

- `lib/ai-providers/fal-photo.ts`: `commitsOnSubmit: true`; `run()` submits then polls `queue.status` every 1 s, calls `hooks.abortCheck`, and on `GenerationCancelledError` fires `queue.cancel(...).catch(() => undefined)` and rethrows IMMEDIATELY with no confirmation; `FalQueueLike.cancel` is typed `Promise<void>`; `cancelPredictions` counts a cancel as cancelled when the call does not throw.
- `app/api/generate-photo/route.ts` (~line 842–870): for providers with `commitsOnSubmit`, the first `onPrediction` tick calls `markProviderCommitted` (`lib/generation-commit.ts`: sets `cancel_allowed=false, cancel_requested=false`, 3 retries), so cancel is dead from submit. `commitProviderOnce` is request-level (batch: one lock).
- `app/api/generations/cancel/route.ts`: ~line 323 returns 409 `CANCEL_NOT_ALLOWED` when `cancel_allowed` is false; otherwise `requestCancel` then `cancelRecordedPredictions` (calls `cancelByRecordedProvider` → adapter `cancelPredictions` immediately, so the endpoint already sends the Fal cancel itself: decide who owns the single authoritative Fal cancel call so it is not issued twice and its result is not discarded).
- `lib/generation-cancel.ts`: `makeReplicateCancelHooks.abortCheck` = `assertNotCancelled`; `isCancelRequested` returns false when commit-locked.
- `lib/use-idempotent-submit.ts` `cancel()` (~line 135): on 409 `CANCEL_NOT_ALLOWED` and on any other error it only `setCancelling(false)` and returns false: silent.
- `GenerationCancelButton` swaps Cancel for "Finalizing…" only after the poll reports `cancelAllowed=false` (`readGenerationCancelAllowed`).
- Atomic workflow RPC `supabase/migrations/066_atomic_generation_settlement.sql` computes refund eligibility from `provider_committed_at is null and cancel_allowed`; durable-workflow jobs must stay on their own path (jobs choose legacy or workflow once; this issue is the legacy photo path only).
- Fal photo failures: `ProviderDefinitiveFailureError` (COMPLETED + error or 4xx ApiError) refunds; everything else ambiguous. Keep.

## Acceptance Criteria

Self-checks (new file wired into `package.json` and `npm run ci:checks`) that drive the REAL settlement/refund functions and the real Fal adapter with a FAKE Fal queue (scriptable statuses and cancel responses), plus an in-memory request store where needed:
1. Cancel while queued, Fal confirms → exactly one refund (stable key), job `cancelled`, no image/asset created, no second refund on retry.
2. Cancel while IN_PROGRESS → 409 `CANCEL_NOT_ALLOWED`, charged once, image delivered, no refund.
3. Race: cancel arrives as the run completes → exactly one outcome (never refund + image; never charge without image).
4. Cancel not confirmed (Fal error / unknown response / run completes anyway) → treated as committed: charged, delivered, no refund.
5. Double cancel is idempotent (one Fal cancel, at most one refund).
6. Batch of 2: both queued → full refund; one running → 409, charged for both.
7. Existing Replicate behavior and the #411/#413/#415 policy (definitive failure refunds, ambiguous stays locked) unchanged: existing `test:*` photo/provider/reconcile checks still pass.
8. UI self-check/test of `cancel()`: 409 `CANCEL_NOT_ALLOWED` shows the English toast and moves the button to "Finalizing…"; other failures show a toast; success path unchanged.
9. The attempt trace for each cancel (requested/confirmed/refused/raced) is persisted and visible in admin monitoring.
10. Runbook updated with the research findings (VERIFIED/UNVERIFIED labels, source links), the state machine and the commit definition; CLAUDE.md/AGENTS.md "cancel_allowed=false after provider commit" wording updated to the Fal-specific definition. `npm run ci:checks`, lint and build pass. All UI copy English. Default provider stays Replicate; no change to credit prices.

## Comments
