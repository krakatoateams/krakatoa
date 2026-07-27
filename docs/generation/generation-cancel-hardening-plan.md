# Generation Cancel Hardening — Implementation Plan

> **Status:** Planned (not started).  
> **Audience:** Agents implementing cancel safety across all metered generation routes.  
> **Trigger:** Repo-wide cancel audit (ponytail-audit + code review) found gaps where cancel is ignored, routes lack cancel entirely, or refunds can be skipped.

---

## 1. Purpose

Ensure every **metered** generation attempt can be cancelled safely:

| Dimension | Target |
|-----------|--------|
| **Cost** | No credit charge for a run the user cancelled; minimize post-cancel provider spend (Replicate, Rendi). |
| **Experience** | Cancel button on every long-running metered UI; idle state (not red error) on `GENERATION_CANCELLED`; credits refunded. |
| **Correctness** | Single refund owner (generate route / finalize helper); no double-refund; idempotency key reuse on retry after cancel. |

**Out of scope for this change:**

- Caption helper (`api/generate-caption`) — not metered.
- Splitting `video/page.tsx` (~4000 lines) — tracked as separate refactor; this plan only wires cancel UI where missing.
- Vercel Pro / raising `maxDuration` above 300 — separate infra decision.

---

## 2. Current architecture (keep)

```
Client                          Server
──────                          ──────
useIdempotentSubmit             beginGenerationRequest (idempotency row)
  begin() → Idempotency-Key     spendCredits → provider work
  cancel() →                    makePredictionRecorder → generation_predictions
    POST /api/generations/cancel
      requestCancel (flag)      isCancelRequested between steps
      cancelReplicatePredictions runReplicateWithRetry detects canceled status
                                catch: cancelJob + refundCredits + idem failure
                                return 409 GENERATION_CANCELLED
```

**Do not change:** cancel endpoint must **not** refund (avoids double-refund race). Generate route / `failMotionControlAttempt` remain the refund owner.

**Reference code:**

| Module | Role |
|--------|------|
| `lib/generation-cancel.ts` | DB flag, prediction registry, Replicate cancel |
| `lib/generation-idempotency.ts` | Idempotency row lifecycle |
| `lib/use-idempotent-submit.ts` | Client lock + cancel POST |
| `lib/replicate-server.ts` | `ReplicateCancellationError`, `runReplicateWithRetry` |
| `app/api/generations/cancel/route.ts` | Cancel control plane |

---

## 3. Gap matrix (audit findings)

| Surface | API cancel | UI Cancel | Refund on cancel | Gap |
|---------|-----------|-----------|------------------|-----|
| Reels Creator | Partial | ✅ | ✅ | No cancel during Rendi / Whisper / storage; no pre-finalize check |
| T2V / I2V | Partial | ✅ | ✅ | No cancel during download/upload |
| Motion Control | ✅ | ✅ | ✅ (mostly) | Status route catch skips refund |
| Storyboard→Video | ✅ | ✅ | ✅ | — |
| Storyboard image | ❌ | ❌ | ❌ | Full gap |
| Product Photo | ❌ | ❌ | ❌ | Full gap |
| Storyboard import | ❌ | ❌ | ❌ | Full gap |
| `isCancelRequested` | — | — | — | Returns `false` on DB error (cancel ignored) |
| Vercel 300s kill | — | — | ❌ | Catch may not run; job stuck `running` |

---

## 4. Target behavior (acceptance criteria)

### 4.1 Universal cancel contract (every metered route)

Each route in §5 must implement:

1. **Idempotency** — `beginGenerationRequest` before spend (already true for listed routes).
2. **Prediction recording** — `makePredictionRecorder` on every `runReplicateWithRetry` / `runWithRetry` / `createPredictionWithRetry` tick.
3. **Pre-provider guard** — `isCancelRequested` → throw `ReplicateCancellationError` before first provider call after spend.
4. **Between-step guards** — poll cancel before each expensive step (see §6).
5. **Post-provider safety net** — after each blocking Replicate `run()`, re-check cancel before delivery (download, storage, `markAssetReady`, `finishJob`).
6. **Catch block** — `isCancellation` → `cancelJob` (not `failJob`), `refundCredits` with `reason: generation_cancelled`, `finishGenerationRequestFailure`, HTTP **409** `{ code: "GENERATION_CANCELLED", refunded: boolean }`.
7. **Client** — `useIdempotentSubmit.cancel()`, Cancel button while `loading`, handle 409 → idle (not error toast).

### 4.2 `isCancelRequested` fail-closed

On DB read failure: **one immediate retry**, then treat as **cancelled** (`return true`) and log `console.error`. Rationale: continuing a metered run when cancel state is unknown is worse than aborting with refund.

### 4.3 Provider cost (best-effort)

We cannot un-run completed Replicate predictions. Goals:

- Cancel in-flight predictions via `cancelReplicatePredictions`.
- **Do not start** new Rendi / storage work after `cancel_requested`.
- **Do not deliver** assets after cancel (even if provider output exists).

### 4.4 Stuck / orphaned attempts

Cron (or extended existing cron) reconciles:

- `jobs.status = 'running'` older than lock TTL + buffer, with a matching `spend:*` ledger row and no success output → refund + `failJob` or `cancelJob` + `finishGenerationRequestFailure`.
- `generation_requests.status = 'started'` with stale `locked_until` and no terminal finish → mark failed with `STALE_GENERATION` code (allows client takeover).

---

## 5. Routes to touch

| Route | File | Phase |
|-------|------|-------|
| Reels | `app/api/generate-reels/route.ts` | 2, 3 |
| Seedance pipeline | `lib/reels-pipeline/seedance.ts` | 2 |
| Veo pipelines | `lib/reels-pipeline/veo.ts` | 2 |
| T2V / I2V | `app/api/generate-video/route.ts` | 4 |
| Motion status | `app/api/generate-motion-control/status/route.ts` | 7 |
| Product Photo | `app/api/generate-photo/route.ts` | 5 |
| Storyboard image | `app/api/generate-storyboard/route.ts` | 5 |
| Storyboard import | `app/api/storyboards/import/route.ts` | 6 |
| Cancel endpoint | `app/api/generations/cancel/route.ts` | 9 |
| Core cancel lib | `lib/generation-cancel.ts` | 1 |
| Stuck job cron | `app/api/cron/route.ts` or new `app/api/cron/generation-reconcile/route.ts` | 8 |

**Already OK (verify only, no functional change unless regression):**

- `app/api/generate-storyboard-video/route.ts`
- `app/api/generate-motion-control/route.ts`
- `lib/motion-control-finalize.ts`

---

## 6. Pipeline cancel checkpoints

### 6.1 Shared helper (Phase 1)

Add to `lib/generation-cancel.ts`:

```ts
/** Throws ReplicateCancellationError when cancel was requested. */
export async function assertNotCancelled(profileId: string, generationRequestId: string): Promise<void>
```

Use in routes and pipelines instead of inline `if (await isCancelRequested(...)) throw ...`.

### 6.2 Seedance (`lib/reels-pipeline/seedance.ts`)

Add `await ctx.isCancelled()` → throw **before**:

| Step | After line / step name |
|------|------------------------|
| LLM style anchor | start of step 1A (before `generateSeedanceStyle`) |
| LLM scene breakdown | before `generateScenes` |
| TTS pipeline | before `runTtsPipeline` |
| Video generation | already present |
| Post parallel video | already present |
| Rendi concat | before `concatScenes` |
| Rendi merge | before `mergeVideoAudioSubs` |
| Rendi burn | before `burnSubtitles` |
| Storage upload | before `downloadAndStoreFinal` |

### 6.3 Veo single (`lib/reels-pipeline/veo.ts` — `runVeoSinglePipeline`)

Add checks before:

- LLM prompt step
- Veo `runWithRetry` (already before)
- Post Veo (already after)
- `extractVeoAudio` (Rendi)
- Whisper `runWithRetry`
- ASS upload + `burnSubtitles`
- `downloadAndStoreFinal`

### 6.4 Veo per-scene (`runVeoPerScenePipeline`)

Add checks before:

- LLM steps (style + scenes)
- Parallel Veo batch (already partial)
- Post parallel batch
- Rendi concat / merge / burn
- Storage upload

### 6.5 `generate-reels/route.ts` (Phase 3)

After `runSeedancePipeline` / `runVeo*` returns, **before** `markAssetReady`:

```ts
if (generationRequestId && profileId) {
  await assertNotCancelled(profileId, generationRequestId);
}
```

Defense-in-depth if pipeline missed a checkpoint.

### 6.6 `generate-video/route.ts` (Phase 4)

After post-run cancel check, add checks:

- Before `fetch(generatedVideoUrl)` (download)
- Before `supabaseServer.storage.upload`
- Before `markAssetReady` / `finishJob`

---

## 7. New metered routes — cancel pattern (Phases 5–6)

Copy the **generate-video** template (not reels — simpler single prediction):

### 7.1 `generate-photo/route.ts`

- Import cancel helpers + `isCancellation`, `ReplicateCancellationError`.
- Wire `makePredictionRecorder` into `runWithRetry` (grep existing replicate calls).
- Pre-provider + post-provider `assertNotCancelled`.
- Catch: `cancelJob` + refund with `generation_cancelled` + 409 response.

### 7.2 `generate-storyboard/route.ts`

Same as 7.1. Multiple LLM/image steps — `assertNotCancelled` before each `runWithRetry` cluster.

### 7.3 `storyboards/import/route.ts`

Same pattern. Vision LLM step before provider — guard before and after replicate/vision call.

---

## 8. UI work (Phases 5–6)

### 8.1 Shared component (optional, recommended)

Extract from `video/page.tsx` into `components/studio/CancelGenerationButton.tsx`:

- Props: `loading`, `cancelling`, `onCancel`
- Uses `CANCEL_BTN_CLASS` from `components/studio/CreditButton.tsx`

Reduces copy-paste across composers.

### 8.2 `photo-v2/page.tsx`

| Composer | Hook change | Cancel button |
|----------|-------------|---------------|
| Storyboard generator (~line 152) | `cancel: cancelSubmit, cancelling` | While `loading` |
| Product Photo (~line 486) | same | While `loading` |

Handle `data.code === "GENERATION_CANCELLED"` → `setLoading(false)`, clear error, `attempt.settle(false)` (keep key for deduped retry).

Mirror `video/page.tsx` 409 handling.

### 8.3 `video/page.tsx`

| Composer | Current | Action |
|----------|---------|--------|
| Storyboard upload import (~line 2175) | `begin` only | Add cancel + button |
| Others | Already wired | Regression test only |

---

## 9. Motion control status fix (Phase 7)

`app/api/generate-motion-control/status/route.ts` catch block:

```ts
if (isCancellation(error)) {
  // Build ctx from generationRequest (same as happy path)
  await failMotionControlAttempt(ctx, errJson, { cancelled: true });
  return NextResponse.json({ ... }, { status: 409 });
}
```

Ensure `ctx` is available in catch ( hoist `ctx` declaration or rebuild from `generationRequest`).

Also align `refunded` field: use `creditsAmount > 0` (not hardcoded `true`) unless refund confirmed.

---

## 10. Stuck job reconciliation (Phase 8)

### 10.1 New module `lib/generation-reconcile.ts`

Functions:

- `findStaleRunningJobs(cutoff: Date)` — jobs `running` where `updated_at < cutoff` (or `started_at`).
- `findOrphanedGenerationRequests(cutoff)` — `started` + `locked_until < now()`.
- `reconcileStaleJob(job)` — if `credit_transactions` has `spend:*` for job and no matching refund:
  - `refundCredits` idempotency `refund:reconcile:{jobId}`
  - `failJob` with `{ code: 'STALE_GENERATION', message: '...' }`
  - linked `finishGenerationRequestFailure` if `generation_requests.job_id` matches

**Do not refund** if job already `succeeded` / `failed` / `cancelled`.

### 10.2 Cron entry

Option A: add section to `app/api/cron/route.ts` (if CRON_SECRET protected).  
Option B: `GET /api/cron/generation-reconcile` (matches `storage-sweep` pattern).

Schedule: every 15–30 minutes. Cutoff: `LOCK_TTL_MS` (15 min) + 5 min buffer from `generation-idempotency.ts`.

### 10.3 Logging

One line per reconciled job: `profileId`, `jobId`, `refunded`, `reason`.

---

## 11. Cancel endpoint UX (Phase 9)

`app/api/generations/cancel/route.ts`:

| Case | Current | Target |
|------|---------|--------|
| No row yet | 404 `not_found` | 202 `status: 'pending'` (cancel will apply when row exists) **OR** keep 404 but client retries cancel — document choice |
| Already `started` + `cancel_requested` | re-cancel | 200 `status: 'already_cancelling'` (idempotent) |
| Terminal success | `already_completed` | keep |

**Recommendation:** return `202 { status: 'pending' }` when row missing (client already sent cancel; generate route will see flag once row exists if we also support early cancel queue — **defer queue**, keep 404 + client retry 2–3s for minimal scope).

Add `already_cancelling` when `cancel_requested` already true.

---

## 12. Idempotency semantics (no migration required)

Keep `generation_requests.status` as `started | succeeded | failed`. Cancel → `failed` + `error_json.code = GENERATION_CANCELLED`.

On retry with same key: `beginGenerationRequest` takeover resets `cancel_requested: false` → fresh attempt. **Document in catch** — no schema change.

Optional follow-up: add `cancelled` status enum — **not in this plan**.

---

## 13. Ponytail cleanup (Phase 10 — separate PR acceptable)

| Item | Action |
|------|--------|
| Duplicate `extractMediaUrl` | Keep in `replicate-server.ts`; re-export from `replicate-utils.ts` |
| Duplicate `runWithRetry` / `runReplicateWithRetry` | Single implementation in `replicate-server.ts` |
| Duplicate `isMissingObject` | Shared `lib/generation-db-errors.ts` |
| `video/page.tsx` size | Defer split; not blocking cancel |

Can land after functional cancel PR merges.

---

## 14. Implementation phases (ordered)

```
Phase 1 — Core lib (1 PR slice)
  □ isCancelRequested fail-closed + retry
  □ assertNotCancelled helper
  □ Unit-style self-check in generation-cancel.ts (ponytail runnable check)

Phase 2 — Reels pipelines
  □ seedance.ts checkpoints (§6.2)
  □ veo.ts single + per-scene checkpoints (§6.3)
  □ Manual: cancel during Rendi → 409 + refund, no asset in history

Phase 3 — generate-reels pre-finalize guard
  □ assertNotCancelled before markAssetReady block

Phase 4 — generate-video download/upload guards
  □ §6.6

Phase 5 — Photo + Storyboard image
  □ API routes §7.1–7.2
  □ photo-v2 UI §8.2

Phase 6 — Storyboard import
  □ API route §7.3
  □ video/page upload composer UI §8.3

Phase 7 — Motion control status catch
  □ §9

Phase 8 — Stuck job cron
  □ lib/generation-reconcile.ts + cron route §10

Phase 9 — Cancel endpoint polish
  □ §11 (minimal: already_cancelling)

Phase 10 — Ponytail dedup (optional follow-up PR)
  □ §13

Phase 11 — Docs
  □ Update CLAUDE.md cancel section + link this doc
  □ Short Indonesian summary: docs/generation/generation-cancel-hardening-ringkasan.md
```

**Merge strategy:** Phases 1–4 first (highest cost risk on Video/Reels). Phases 5–6 (Photo gaps). Phases 7–9 (edge cases). Phase 8 can parallelize after Phase 1.

---

## 15. Test plan

### 15.1 Manual (required before merge)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Reels: cancel during LLM (before video) | 409, refund, job cancelled, no video |
| 2 | Reels: cancel during parallel Seedance | 409, refund, partial Replicate may complete |
| 3 | Reels: cancel during Rendi stitch | 409, refund, **no** final video in storage/history |
| 4 | T2V: cancel after Replicate, before upload | 409, refund, no asset ready |
| 5 | Product Photo: cancel mid-generation | 409, refund, Cancel button works |
| 6 | Storyboard image: cancel mid-generation | same |
| 7 | Storyboard import: cancel during vision | same |
| 8 | Motion Control: cancel while polling | 409, refund |
| 9 | Retry after cancel (same inputs) | New generation works; not blocked |
| 10 | Double cancel click | Idempotent; no double refund (check ledger) |

### 15.2 Ledger verification (SQL)

After each cancel test:

```sql
select type, amount, idempotency_key, metadata
from credit_transactions
where profile_id = '<profile>'
order by created_at desc
limit 5;
```

Expect: `spend` + matching `refund` with same job id in keys.

### 15.3 Automated (minimal ponytail check)

`lib/generation-cancel.self-check.ts` or inline in module:

- `isCancelRequested` returns true when `cancel_requested` true (mock supabase optional; or export pure helpers only).

Defer full integration tests until test harness exists.

---

## 16. Rollout & risk

| Risk | Mitigation |
|------|------------|
| False-positive cancel on DB blip | Single retry before fail-closed; alert on error logs |
| Reconcile cron double-refund | Idempotency key `refund:reconcile:{jobId}`; skip if refund exists |
| Rendi still runs one job after cancel | Accept best-effort; checkpoint before each Rendi call |
| Vercel 300s kill without catch | Phase 8 cron backstop |
| Large video/page diff | UI changes scoped to cancel wiring only |

**DB migrations:** None required (023 already applied). Verify via MCP `list_migrations` includes `generation_cancellation`.

---

## 17. Definition of done

- [ ] All rows in §3 gap matrix marked ✅
- [ ] §15 manual tests 1–10 passed on staging
- [ ] No route with `spendCredits` lacks cancel path (grep audit)
- [ ] CLAUDE.md updated
- [ ] This doc status → **Complete**

---

## 18. File checklist (quick reference)

```
lib/generation-cancel.ts          — Phase 1
lib/generation-reconcile.ts       — Phase 8 (new)
lib/reels-pipeline/seedance.ts    — Phase 2
lib/reels-pipeline/veo.ts         — Phase 2
app/api/generate-reels/route.ts   — Phase 3
app/api/generate-video/route.ts   — Phase 4
app/api/generate-photo/route.ts   — Phase 5
app/api/generate-storyboard/route.ts — Phase 5
app/api/storyboards/import/route.ts  — Phase 6
app/api/generate-motion-control/status/route.ts — Phase 7
app/api/generations/cancel/route.ts — Phase 9
app/(app)/tools/photo-v2/page.tsx — Phase 5
app/(app)/tools/video/page.tsx    — Phase 6 (import composer)
components/studio/CancelGenerationButton.tsx — Phase 5 (optional)
app/api/cron/generation-reconcile/route.ts — Phase 8 (optional path)
CLAUDE.md                         — Phase 11
```
