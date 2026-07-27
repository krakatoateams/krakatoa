# No cancel / no refund after Replicate success — Implementation Plan

> **Status:** Proposed (not implemented)  
> **Audience:** Agents implementing billing + cancel policy  
> **Trigger:** Financial risk — user can cancel during Rendi (or after scene video succeeded) and receive a **full Krakatoa credit refund** while Replicate/Rendi provider cost is already committed.

---

## 1. Product policy (authoritative)

### 1.1 Rule

Once Replicate has **successfully produced the primary provider output** for an attempt (video URL, image URL, or equivalent — meaning Krakatoa has incurred or is committed to non-refundable provider cost for that deliverable), the user:

1. **Cannot cancel** the attempt in a way that stops delivery and refunds credits.
2. **Cannot receive a refund** for that attempt via the normal cancel path.

The user must wait for **success** (final asset delivered) or **terminal failure** (failed job, or recoverable + resume/abandon flows).

### 1.2 Still allowed

| Action | When |
|--------|------|
| Cancel + full refund | **Before** primary Replicate output succeeds (LLM-only, TTS, prediction still running, etc.) |
| Abandon recoverable job + refund | Job status `recoverable` — separate `POST /api/generations/cancel { jobId }` (not in-flight cancel) |
| Cron reconcile refund | Stale run TTL / Vercel kill — existing reconcile (unchanged) |

### 1.3 Out of scope (this change)

- Partial / pro-rata refund by scene (Krakatoa charges one lump `spend` at job start today).
- Cancelling in-flight **Rendi** FFmpeg jobs on Rendi’s side (no cancel API wired; we only stop polling).
- Caption helper (`generate-caption`) — not metered.

### 1.4 Relationship to cancel-hardening v1

[`generation-cancel-hardening-plan.md`](generation-cancel-hardening-plan.md) optimizes for **user can always cancel + full refund**. This plan **overrides** that after the irreversible point:

- Cancel endpoint may **reject** instead of only flipping `cancel_requested`.
- Generate routes must **ignore** `cancel_requested` after commit (do not throw `ReplicateCancellationError`).
- Refund owner still generate route / finalize helper — but **no refund** when commit already happened.

---

## 2. Definition: “Replicate success” (per route)

Use **one primary commit point** per job type — the step where the expensive visual (or motion) output exists.

| Tool | Route | Irreversible when | `job_steps.step_key` signal |
|------|-------|-------------------|-----------------------------|
| Text / image → video | `generate-video` | `extractMediaUrl(output)` is valid HTTP URL after `runWithRetry` | `video_generation` step **finished** (`status = succeeded`) |
| Storyboard → video | `generate-storyboard-video` | Same after storyboard video `runReplicateWithRetry` | `video_generation` finished |
| Motion control | `generate-motion-control` + `status` | Replicate prediction `status === succeeded` | `motion_control_generation` started + prediction succeeded (or step finished) |
| Reels Creator (Seedance) | `generate-reels` → `runSeedancePipeline` | **All** scene videos generated (`video_generation` step **ended**) | `video_generation` finished; manifest `artifacts.scenes.length > 0` |
| Reels Creator (Veo single) | `generate-reels` → `runVeoSinglePipeline` | Veo clip URL valid after `video_generation` | `video_generation` finished; `artifacts.veoVideo` or replicate video checkpoint |
| Reels Creator (Veo per-scene) | `generate-reels` → `runVeoPerScenePipeline` | Same as Seedance — all scene clips done | `video_generation` finished |
| Product / character / image | `generate-photo` | Image URL valid after `runWithRetry` | `image_generation` finished |
| Storyboard sheet | `generate-storyboard` | Image URL valid after image `runReplicateWithRetry` | `image_generation` finished |
| Storyboard import | `storyboards/import` | **Not** after vision LLM alone — no separate image gen; irreversible after vision step produces stored storyboard? **Decision:** treat as committed when vision JSON parsed and storage move begins, OR only if a future image step exists. **v1:** after `vision_analysis` step **finished** (vision on Replicate still costs). Document in §7. |

**Reels nuance:** Provider cost accrues **per scene prediction**. Product choice for v1:

- **Recommended:** irreversible when entire `video_generation` step completes (all scenes), not after first scene — avoids “1 scene done, user locked in” while job still running other scenes.
- **Alternative (stricter):** irreversible after **first** scene succeeds — better for dev cost, worse UX.

**LLM-on-Replicate** (`scene_breakdown`, `style_anchor`, vision): still refundable until primary visual commit in v1. Optional Phase 2: mark irreversible after first successful LLM prediction if finance requires.

---

## 3. Target behavior (acceptance criteria)

### 3.1 Cancel API

`POST /api/generations/cancel { idempotencyKey }`:

- If attempt is **before** irreversible point → current behavior (`cancel_requested`, Replicate cancel, 200 `cancelling`).
- If **after** irreversible point → **409** `{ code: "CANCEL_NOT_ALLOWED", message: "…", cancelAllowed: false }` — **do not** set `cancel_requested`.

`POST /api/generations/cancel { jobId }` (abandon recoverable): unchanged.

### 3.2 Generate routes / pipelines

- **`abortCheck` / `assertNotCancelled` / `abortIfCancelled`:** if irreversible, **no-op** (ignore `cancel_requested`; continue pipeline).
- **Catch block:** `isCancellation(error)` only true **before** commit; after commit, never refund for cancellation.
- **After commit:** user cancel click has no effect; generation continues through Rendi, upload, `markAssetReady`.

### 3.3 UI

- While `loading`, poll lightweight status (see §5).
- Show **Cancel** only when `cancelAllowed === true`.
- After commit: hide Cancel; show neutral status e.g. “Finalizing your video…” (no refund implication).
- If user somehow gets 409 `CANCEL_NOT_ALLOWED`, do not show error — treat as informational (optional toast).

### 3.4 Billing

- **No refund** after irreversible commit on user cancel.
- **Recoverable** failures after commit: credits **held** (existing) — user resumes or abandons.
- **Terminal fail** after commit: existing best-effort refund policy (unchanged unless product says no refund on fail after provider success — **default: still refund on terminal fail**).

---

## 4. Architecture

### 4.1 Source of truth (pick one primary, optional secondary)

**Option A — `job_steps` (recommended):**

- Query: exists row with `step_key` in commit set and `status = 'succeeded'` for `job_id`.
- Pros: already written by routes; auditable; works for progress UI.
- Cons: best-effort steps — if `finishJobStep` fails, gate could be wrong (fail-safe: prefer **no refund** if ambiguous? or allow cancel — product choice; **recommend fail-closed for finance: treat running `video_generation` without finish as not yet committed until step succeeds**).

**Option B — Recovery manifest artifacts:**

- `artifacts.scenes.length > 0`, `replicateVideoUrl`, `veoVideo`, etc.
- Pros: aligns with resume.
- Cons: only when recovery handle enabled; not all paths.

**Option C — Explicit flag on `generation_requests` or `jobs`:**

- `provider_committed_at` or `cancel_allowed: false` set at commit moment.
- Pros: single cheap read for cancel endpoint.
- Cons: new column or JSON patch; must set in every route.

**Recommendation:** **A + C hybrid**

1. At commit moment: `finishJobStep` for the commit step (already) + `setGenerationCancelAllowed(id, false)` on `generation_requests` (new helper, optional column `cancel_allowed` default `true`, flip to `false` at commit).
2. Cancel endpoint reads `cancel_allowed` (fast) with fallback to job_steps query.

Migration sketch (Phase 1):

```sql
alter table generation_requests
  add column if not exists cancel_allowed boolean not null default true;
```

Idempotent; flip `false` at irreversible point; reset `true` on idempotency takeover (same as `cancel_requested` reset).

### 4.2 New module

`lib/generation-commit.ts` (name TBD):

```ts
export const IRREVERSIBLE_STEP_KEYS = {
  video_generation: ["video_generation", "motion_control_generation"],
  image_generation: ["image_generation"],
  storyboard_import: ["vision_analysis"], // if product confirms
  reels: ["video_generation"],
} as const;

export async function markGenerationCommitted(params: {
  generationRequestId: string;
  profileId: string;
  reason: string;
}): Promise<void>;

export async function isGenerationCommitLocked(
  profileId: string,
  generationRequestId: string,
  jobId?: string | null,
): Promise<boolean>;

export async function assertCancelAllowed(...): Promise<void>; // throws typed error for cancel API
```

Wire `markGenerationCommitted` immediately after validating provider URL (and after `endStep` for that step).

Update `lib/generation-cancel.ts`:

- `assertNotCancelled` → if `isGenerationCommitLocked`, return without throwing.
- `isCancelRequested` → if locked, return `false` (ignore stale `cancel_requested` flag).

### 4.3 Cancel endpoint

Before `requestCancel`:

```ts
if (await isGenerationCommitLocked(profileId, existing.id, existing.job_id)) {
  return NextResponse.json(
    { code: "CANCEL_NOT_ALLOWED", message: "Generation can no longer be cancelled.", cancelAllowed: false },
    { status: 409 },
  );
}
```

### 4.4 Replicate / Rendi hooks

- `makeReplicateCancelHooks` `abortCheck`: call `assertNotCancelled` which respects lock.
- Rendi `abortCheck`: same — after video commit, Rendi polling ignores cancel.

### 4.5 Progress API (for UI)

`GET /api/generations/status?idempotencyKey=` or header `Idempotency-Key`:

```json
{
  "status": "started",
  "cancelAllowed": true,
  "phase": "video_generation",
  "jobId": "..."
}
```

Implementation:

- Read `generation_requests` + latest `job_steps` for `job_id` (or join).
- `cancelAllowed` from `generation_requests.cancel_allowed` or derived.
- `phase` = latest running step’s `step_key` or manifest `step` for reels.

Poll every 2–3s while client `loading` (Reels, T2V, photo — all long POST). Motion control already polls status — extend response with `cancelAllowed`.

---

## 5. UI work

| Surface | Change |
|---------|--------|
| `lib/use-idempotent-submit.ts` | Optional: `cancel()` returns false + reason if poll says not allowed; or cancel POST handles 409 |
| `video/page.tsx` — Reels, T2V, I2V, storyboard video | Poll status; conditional Cancel button |
| `video/page.tsx` — motion control | Extend existing poll handling for `cancelAllowed` |
| `video/page.tsx` — storyboard import | Poll if import becomes long; or gate on vision step |
| `photo-v2/page.tsx` — product + storyboard | Poll during `loading` |

Shared (optional): `components/studio/CancelGenerationButton.tsx` with `cancelAllowed` prop.

---

## 6. Implementation phases

### Phase 0 — Decisions (product sign-off)

- [ ] Reels: irreversible after **all** scenes vs **first** scene.
- [ ] Storyboard import: irreversible after vision LLM vs only after image gen.
- [ ] Terminal fail after commit: still full refund? (default yes).
- [ ] DB: `cancel_allowed` column vs job_steps-only.

### Phase 1 — Server gate + billing

- [ ] Migration `055_generation_cancel_allowed.sql` (if using column).
- [ ] `lib/generation-commit.ts` + integrate `markGenerationCommitted` in each route at commit points (table in §2).
- [ ] Update `assertNotCancelled` / cancel endpoint.
- [ ] Generate route catches: do not treat as `cancelled` if commit locked (defense in depth).
- [ ] `throwRecoverableIfCheckpointed` — already skips `isCancellation`; keep.

### Phase 2 — Reels pipeline

- [ ] `markGenerationCommitted` at end of `video_generation` in `seedance.ts` / `veo.ts` (needs `generationRequestId` on context — **may require passing id through `ReelsPipelineContext`**).
- [ ] Remove or update comment “Post-run cancel safety net (refund + skip Rendi)” — after this plan, cancel before Rendi still allowed until `video_generation` ends; after it ends, no cancel.

### Phase 3 — Progress API + UI

- [ ] `GET /api/generations/status`
- [ ] Poll in video + photo composers; hide Cancel when `!cancelAllowed`.
- [ ] Status line: “Generating…” vs “Finalizing…”

### Phase 4 — Tests

- [ ] Pure tests: `isGenerationCommitLocked` logic with mocked steps / `cancel_allowed`.
- [ ] Manual matrix (§8).

### Phase 5 — Docs

- [ ] Update `CLAUDE.md` billing contract.
- [ ] Update `generation-cancel-hardening-plan.md` §1 acceptance criteria.
- [ ] Indonesian ringkasan `no-refund-after-replicate-ringkasan.md`.

---

## 7. Route checklist (where to call `markGenerationCommitted`)

| File | Call site (after valid provider URL + `endStep` for generation step) |
|------|----------------------------------------------------------------------|
| `app/api/generate-video/route.ts` | After `endStep` following `runWithRetry` + URL check |
| `app/api/generate-storyboard-video/route.ts` | Same |
| `app/api/generate-photo/route.ts` | After image `runWithRetry` + URL check |
| `app/api/generate-storyboard/route.ts` | After image `runReplicateWithRetry` + URL check |
| `app/api/storyboards/import/route.ts` | After vision step success (if product confirms) |
| `app/api/generate-motion-control/status/route.ts` | On prediction `succeeded` before finalize (commit before download) |
| `lib/reels-pipeline/seedance.ts` | After `endStep` for `video_generation` (all scenes) |
| `lib/reels-pipeline/veo.ts` | After `video_generation` / per-scene batch complete |

**Reels context gap:** `ReelsPipelineContext` today has no `generationRequestId`. Add optional fields:

```ts
generationRequestId?: string | null;
profileId?: string | null;
onProviderCommitted?: () => Promise<void>;
```

Route sets `onProviderCommitted: () => markGenerationCommitted(...)`.

---

## 8. Manual test matrix

| # | Action | Expected |
|---|--------|----------|
| 1 | T2V cancel during Replicate poll (before success) | Cancel OK, refund, 409 GENERATION_CANCELLED |
| 2 | T2V cancel after Replicate success (during download) | Cancel API 409 CANCEL_NOT_ALLOWED; no refund; video completes |
| 3 | Reels cancel during LLM | Cancel OK, refund |
| 4 | Reels cancel during scene 1 of 3 (if policy = all scenes) | Cancel OK, refund |
| 5 | Reels cancel during Rendi after all scenes done | Cancel blocked; no refund; final MP4 or recoverable on Rendi fail |
| 6 | Photo cancel during image gen | Cancel OK |
| 7 | Photo cancel after image URL | Cancel blocked |
| 8 | Motion control cancel before succeeded | Cancel OK |
| 9 | Motion control cancel after succeeded | Cancel blocked on status poll |
| 10 | Recoverable abandon `{ jobId }` after commit | Still refunds (explicit abandon) |

---

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| User stuck with no Cancel during long Rendi | Status text “Finalizing…”; Rendi usually &lt; few min |
| `finishJobStep` fails but Replicate succeeded | Call `markGenerationCommitted` **before** or regardless of step finish; step is audit-only |
| Stale `cancel_requested=true` before lock | `isCancelRequested` returns false when locked |
| Double refund | Cancel endpoint never refunds; generate catch unchanged for fail paths |
| Vercel 300s kill after commit | Reconcile → recoverable or fail; not user cancel |

---

## 10. Effort estimate

| Phase | Size |
|-------|------|
| Phase 1 server | ~1–2 days |
| Phase 2 reels context | ~0.5 day |
| Phase 3 UI + status API | ~1 day |
| Phase 4–5 tests + docs | ~0.5 day |

**Total:** ~3–4 days focused work.

---

## 11. References

- [`lib/generation-cancel.ts`](../../lib/generation-cancel.ts)
- [`app/api/generations/cancel/route.ts`](../../app/api/generations/cancel/route.ts)
- [`lib/reels-pipeline/seedance.ts`](../../lib/reels-pipeline/seedance.ts) — `video_generation` → `rendi_render` boundary
- [`docs/generation/pipeline-recovery-plan.md`](pipeline-recovery-plan.md) — recoverable vs cancel
