## Context

Direct investigation of all four layers involved, before proposing anything:

**1. `posts` table has no grouping/linking column.** Every migration touching `posts` was checked (`003_platform_foundation_nextauth_single_user.sql` through `045_posts_tiktok_fields.sql`). Migration 003's own comment is explicit: *"no scheduled_posts table, no creation_id."* A repo-wide search for `group_id|batch_id|parent_post|source_id|schedule_id|action_id|post_group|multi_platform` against `posts` returns nothing. There is no server-side concept linking "these N rows were scheduled together as one action" — each row is fully independent.

**2. `POST /api/posts` (`app/api/posts/route.ts`) always inserts one independent row.** `insertRow` (built from the request body) carries no batch/group/parent key. Two requests for the same video targeting two platforms produce two rows with no formal relationship beyond coincidentally similar `video_url`/`scheduled_time`.

**3. `GET /api/cron` (`app/api/cron/route.ts`) is already correctly scoped to one row = one platform.** The claim-lock:
```ts
const { data: claimed } = await supabaseServer
  .from("posts")
  .update({ publish_started_at: now })
  .eq("id", post.id)
  .eq("status", "scheduled")
  .or(`publish_started_at.is.null,publish_started_at.lt.${staleCutoff}`)
  .select("id, youtube_video_id, tiktok_publish_id")
  .maybeSingle();
```
and the retry/give-up logic:
```ts
const attempts = (post.publish_attempts ?? 0) + 1;
const permanent = post.platform === "tiktok" ? isTikTokPermanentFailure(err, message) : isPermanentFailure(err, message);
const giveUp = permanent || attempts >= MAX_PUBLISH_ATTEMPTS;
```
both operate on a single row's single `platform`. Nothing here expects, reads, or writes more than one platform per row. This layer's own idempotency (`youtube_video_id` / `tiktok_publish_id` presence check) and retry cap (`MAX_PUBLISH_ATTEMPTS = 3`) already work correctly at this granularity — a stray duplicate row from a client-side bulk retry would still be independently claimed, independently idempotent, and independently retried by this code. **The cron has no bug.**

**4. The actual gap: `app/(app)/tools/scheduler/page.tsx`'s scheduling-time client state.** `VideoItem` tracks one `scheduleStatus: "idle" | "scheduling" | "scheduled" | "failed"` for the whole item, regardless of how many platforms it targets. `handleScheduleAll` already loops per-platform and fires independent `POST /api/posts` calls via `Promise.allSettled`, correctly reusing per-platform error messages — but on partial failure, the *whole item* is marked `"failed"`, and `scheduleTargets = items.filter((i) => itemReady(i) && i.scheduleStatus !== "scheduled")` means a retry re-includes it, re-looping over **all** of `it.platforms`, including the one(s) that already got a `posts` row created. The code's own inline comment already named this as an accepted-for-now limitation. `handleSubmit` (single mode) has the identical shape: `resetForm()` only runs in the `failed.length === 0` branch, so a partial failure leaves the form's platform selection untouched — clicking "Schedule Post" again resubmits every platform, including the one that already succeeded.

**Conclusion:** this is a **pure client-side state-tracking bug**, not a data-model gap. No DB table, column, or migration is needed to fix it — the cron and `POST /api/posts` are already correctly single-platform-per-row and don't need to know a "batch" exists.

## Goals / Non-Goals

**Goals:**
- Retrying a partially-failed multi-platform schedule (single or bulk mode) only resubmits the platform(s) that actually failed — never re-POSTs a platform that already has a `posts` row.
- Bulk mode's per-card status becomes accurate when a card targets more than one platform (no more collapsing "1 succeeded, 1 failed" into a single "Failed" badge with no detail beyond the error string).

**Non-Goals:**
- No DB schema change, no new table, no migration — confirmed unnecessary per Context above.
- No change to `app/api/posts/route.ts` or `app/api/cron/route.ts` — both already correct.
- No `group_id`/`batch_id` concept linking sibling posts server-side — not needed for this fix (see Alternatives).
- No change to the credits system's separate, unrelated idempotency gap — explicitly out of scope per the request.
- No change to single-platform scheduling's behavior or appearance — the fix only changes what happens when **more than one** platform is selected.

## Decisions

### 1. Track per-platform result on the client `VideoItem`, not the server
Add `platformResults: Partial<Record<"youtube" | "tiktok", { status: "success" | "failed"; error?: string }>>` to `VideoItem`. This is pure client-side scheduling-time bookkeeping — it exists only to answer "which of this card's platforms still need submitting," and is discarded once the item is fully scheduled (or the page reloads). It does not need to survive a page refresh mid-retry (an acceptable trade-off — a refreshed page re-derives its target list from scratch, same as today).

### 2. Both `handleSubmit` and `handleScheduleAll` only submit platforms not already `"success"`
Instead of always mapping over `platforms`/`it.platforms`, both functions filter to `platforms.filter((p) => platformResults[p]?.status !== "success")` before building the `Promise.allSettled` batch. After each settles, `platformResults` is updated per platform (`"success"` or `"failed"` + message). The item's aggregate `scheduleStatus` becomes `"scheduled"` only when every selected platform's `platformResults[p]?.status === "success"`; otherwise it stays `"failed"` and the un-succeeded platforms remain retryable.

### 2a. Correction discovered during implementation: single mode's `onSuccess()` wiped the form on every outcome, not just failure
This Context section originally described single mode as having "the identical shape" bug as bulk mode, based on `resetForm()` only running in the `failed.length === 0` branch — implying a failed submit left the platform selection intact for a retry. That was incomplete: `handleSubmit`'s final line, `onSuccess()`, was called **unconditionally** (success, partial failure, or total failure alike), and mapped to the page's `handleSuccess`, which does `setItems([makeDraft(today)])` — wiping `item0` back to a blank draft regardless of outcome. Bulk mode has no equivalent unconditional wipe (its loop only calls `fetchPosts()`, never resets `items`).

Left as originally written, Decision 2's `platformResults` tracking would have been created and then immediately discarded within the same `handleSubmit` call for single mode — dead code, never actually preventable-retry-tested, since the item ceases to exist in that state before the user could ever click "Schedule Post" again.

**Fix:** split the single combined `onSuccess` callback into two:
- `onSuccess` (unchanged prop, mapped to `handleSuccess`) — now called only when `failed.length === 0` (full success). Still does the full wipe + `fetchPosts()`.
- `onPostCreated` (new prop, mapped directly to the page's `fetchPosts`) — called whenever at least one platform succeeded this attempt, so the Recent Posts list reflects the new row even on a partial failure, without wiping the draft.

This is a necessary in-scope correction, not scope creep: without it, the stated goal ("single mode: repeat the bulk-mode fix, confirm no duplicate resubmit") isn't actually achievable, since the draft never survives long enough to be retried.

### 3. Bulk mode shows a per-platform breakdown only when >1 platform is selected
`BulkVideoCard`'s status corner (today: one badge — "Scheduling…" / "Scheduled ✅" / "Failed ❌") stays exactly as-is for single-platform cards (the overwhelming common case, and what most existing screenshots/expectations are built around). When `item.platforms.length > 1`, it instead renders one small line per platform (e.g. "YouTube ✓" / "TikTok ✗ — `<error>`"), sourced from `platformResults`. Single mode's existing toast message (already per-platform, e.g. *"Scheduled to YouTube. Failed: TikTok: ..."*) needs no change — it already communicates this correctly; only its retry behavior (Decision 2) was buggy, not its messaging.

### 4. Calendar / Recent Posts need no change
Each platform is already its own independent `posts` row with its own accurate status — the calendar and Recent Posts list already show per-platform state correctly today (confirmed: the only prior calendar bug, a hardcoded "YouTube" label regardless of `post.platform`, was already fixed in a separate change). This decision exists to explicitly rule out touching those views — the gap is isolated to the pre-submission scheduling UI's retry bookkeeping.

## Risks / Trade-offs

- **`platformResults` is not persisted.** If the user reloads the page mid-way through a partially-failed multi-platform bulk schedule, the in-memory record of "YouTube already succeeded for this card" is lost, and the card itself reverts to a fresh draft state (today's behavior is the same — reloading already loses all draft/`VideoItem` state, since it's never been persisted). This isn't a regression; it's consistent with the page's existing "drafts are client-only until scheduled" model.
- **Doesn't prevent duplicates from other causes** — e.g. a genuine double-click before `submitting`/`schedulingAll` locks engage (already guarded today), or two browser tabs open concurrently. Out of scope: this fix targets the specific retry-after-partial-failure path described in the bug report, not every conceivable double-submission source.

## Alternatives Considered

- **Server-side `group_id`/`batch_id` column linking sibling `posts` rows** — this was the original hypothesis driving this investigation. Rejected for this fix: it would let the server itself answer "which siblings already exist for this schedule action," which is a nice-to-have for future features (e.g. "cancel all platforms for this video" or cross-platform analytics), but is unnecessary complexity to fix a bug that is entirely about the client not tracking its own already-sent requests. Revisit only if a future feature actually needs server-side grouping.
- **Have `POST /api/posts` upsert instead of insert (dedupe on video_url+platform+scheduled_time)** — rejected: fragile (legitimate re-scheduling of the same video to the same platform at a different time, or intentionally re-posting identical content, would be silently blocked or would need a more complex uniqueness key), and treats a client bug as a server-side constraint problem. Fixing the client's own bookkeeping is more direct and has no side effects on legitimate use cases.
- **Disable retry entirely on partial failure (force full manual re-entry)** — rejected: worse UX than the current "Schedule All" retry model for no real benefit; the per-platform fix keeps the existing retry gesture and just makes it correct.
