## Context

`app/api/cron/route.ts` currently: fetches up to `MAX_POSTS_PER_RUN` (1) due `posts` rows, claims one via a conditional update on `publish_started_at` (stale-claim window `CLAIM_STALE_MS`), looks up a `platform_tokens` row by `(post.user_id, post.platform)` — already generic — but then unconditionally calls `uploadToYouTube(...)`. Idempotency is enforced via `claimed.youtube_video_id`: if already set, the post is marked published without re-uploading.

The scheduler UI (`app/(app)/tools/scheduler/page.tsx`) posts to `POST /api/posts` with a hardcoded `platform: "youtube"` in both single-mode (`ScheduleCard`, ~line 735) and bulk mode (~line 1899); the "Platform" UI block (~line 786-796) is a static, non-interactive div with a `ChevronDown` icon that has never been wired to a real dropdown.

`connect-tiktok` already built: `lib/tiktok.ts` (`exchangeCodeForToken`, `refreshAccessToken` — returns the rotated `refresh_token`, `getCreatorInfo`, `resolveOrigin`) and the OAuth connect/disconnect routes. `platform_tokens` rows for `platform: "tiktok"` exist once a user connects.

## Goals / Non-Goals

**Goals:**
- A due `posts` row with `platform: "tiktok"` gets actually published to TikTok by the existing cron, following the same claim-lock/retry/idempotency contract already proven for YouTube.
- Users can choose TikTok as the target platform when scheduling (single + bulk), only when they have a live TikTok connection.
- The rotating-refresh-token hard constraint documented in `connect-tiktok/design.md` is honored: the new refresh token is persisted immediately after every refresh, before attempting the publish call that follows it.

**Non-Goals:**
- No polling TikTok's publish-status endpoint (`/v2/post/publish/status/fetch/`) for final "video actually live" confirmation — publish is considered complete once Init Direct Post returns a `publish_id` (see Decision 1).
- No handling of TikTok's Commercial Content Library / region-specific legal disclosure requirements beyond the two toggle fields captured in Decision 4a (`brand_organic_toggle` / `brand_content_toggle`) — deeper, category-specific rules some regions impose are not covered.
- No Instagram work.
- No change to how `connect-tiktok` itself authorizes/stores tokens.

## Decisions

### 1. Optimistic publish completion (no status polling)
TikTok's Init Direct Post (`FILE_UPLOAD` source) is asynchronous: a successful call returns a `publish_id`, but TikTok processes the video afterward before it's actually live, and a separate status-fetch endpoint reports final success/failure. This change treats a successful Init call (i.e., a returned `publish_id`) as "published," mirroring the existing synchronous mental model YouTube's cron already uses (`uploadToYouTube` returns a video ID and the post is immediately marked published). Rationale: adds no new state machine to the cron, matches `MAX_POSTS_PER_RUN = 1`'s already-conservative throughput, and keeps this change bounded — a later change can add a polling pass (e.g., a second cron sweep over posts with a `tiktok_publish_id` but no confirmed-status flag) if false-positive "published" states turn out to matter in practice.

### 2. Cron dispatch by `post.platform`
`app/api/cron/route.ts`'s existing YouTube branch is untouched. A new `if (post.platform === "tiktok")` branch runs before/instead of the YouTube call. `isPermanentFailure`-style classification is duplicated for TikTok's error shapes (auth/scope failures → permanent; network/5xx → transient), since TikTok's error codes don't overlap with Google's.

### 3. Refresh-then-persist-then-publish ordering
Because TikTok invalidates the old `refresh_token` on every refresh call (documented in `connect-tiktok/design.md` as a hard constraint for this exact change), the TikTok cron branch:
1. Calls `refreshAccessToken(storedRefreshToken)`.
2. **Immediately** upserts the returned `access_token` + rotated `refresh_token` + new `expires_at` into `platform_tokens` — before doing anything else.
3. Only then calls Creator Info + Init Direct Post using the fresh `access_token`.

This ordering matters: if step 3 fails after a successful refresh but the new `refresh_token` wasn't persisted first, the user's stored `refresh_token` would be a stale, already-invalidated one — silently locking them out of future publishes until they reconnect. Persisting right after refresh (step 2), independent of whether publish itself succeeds, avoids that trap.

### 4. Privacy level is captured at schedule time, not defaulted silently
TikTok's Content Posting API expects integrations to expose `privacy_level_options` (from Creator Info) to the user rather than an app silently picking one — auto-defaulting risks review rejection. Since Krakatoa's scheduler has no interactive step at actual publish time (posts are scheduled ahead), the privacy level is captured **at schedule-creation time** instead: when TikTok is selected as the platform, the scheduler fetches the connected account's `privacy_level_options` (via a small new read-only endpoint wrapping `getCreatorInfo`) and shows them in a required dropdown, stored as `posts.tiktok_privacy_level`. The cron reads this stored value at publish time rather than deciding it itself.

### 4a. Content Disclosure is also captured at schedule time, not defaulted
TikTok's Content Posting API requires apps to expose commercial-content disclosure, not silently omit it — Init Direct Post's `post_info` accepts two independent booleans: **`brand_organic_toggle`** (creator promoting their own business) and **`brand_content_toggle`** (paid third-party partnership); either, both, or neither can be true. *(Field names confirmed against TikTok's published Content Posting API reference and Content Sharing Guidelines — see Sources below; exact request-body nesting should still be spot-checked against the live Developer Portal docs during implementation, since third-party summaries were used alongside the primary reference.)*

Mirroring Decision 4: when TikTok is selected as the platform, the scheduler shows a "Disclose video content" toggle alongside the privacy-level dropdown. If enabled, two sub-checkboxes appear — **"Your Brand"** (→ `brand_organic_toggle`) and **"Branded Content"** (→ `brand_content_toggle`) — either or both may be checked. Both values are stored on the post (Decision 5) and read by the cron at publish time, never decided by the backend.

**Hard validation rule (confirmed via TikTok's Branded Content Policy):** `brand_content_toggle = true` cannot be combined with `privacy_level = SELF_ONLY` — branded content must be publicly viewable so TikTok can add it to its Commercial Content Library where legally required. The scheduler UI must disable the "Branded Content" checkbox whenever `SELF_ONLY` is the selected privacy level (matching TikTok's own recommended client behavior), and the cron/`lib/tiktok.ts` publish call must reject (fail fast, not silently drop the flag) rather than send that combination to TikTok.

This rule has a direct consequence for testing: **unaudited (non-App-Review-passed) API clients are restricted to `SELF_ONLY` visibility only**, regardless of what `privacy_level` a user picks. Since Creator Info's `privacy_level_options` for this Sandbox app will therefore only ever offer `SELF_ONLY`, the "Branded Content" checkbox will always render disabled in practice until the app passes App Review — no special Sandbox-only code path is needed, the existing SELF_ONLY-disables-branded-content rule already covers it for free. This means the demo recording can show the disclosure UI existing and the "Your Brand" (organic) option working, but **cannot** demonstrate an actual "Branded Content" publish end-to-end pre-review — flagged in Risks below.

### 5. New `posts` columns, additive migration
`045_posts_tiktok_fields.sql`: `tiktok_publish_id text` (idempotency, mirrors `youtube_video_id`, which itself predates the migrations folder), `tiktok_privacy_level text` (nullable — only meaningful for TikTok-targeted posts), `tiktok_brand_organic_toggle boolean` (nullable, defaults to `false`-equivalent when null), and `tiktok_brand_content_toggle boolean` (same). Two booleans were chosen over a single `'none' | 'your_brand' | 'branded_content'` enum because TikTok's own API shape is two independent flags (both can be true simultaneously — e.g. a creator's own brand under a paid partnership) — an enum would either lose that combination or need a fourth value, so mapping 1:1 to the API's actual request shape is simpler and lossless. All four columns `add column if not exists`, matching the repo's established convention (`012_posts_format.sql`).

### 6. Chunked upload sizing
TikTok's Init Direct Post (`FILE_UPLOAD`) requires `video_size`, `chunk_size`, and `total_chunk_count` up front. The video's byte size is read via a `HEAD` request against the Supabase Storage public URL (`post.video_url`) before Init; chunk size follows TikTok's bounds (5 MB–64 MB per chunk, single chunk if the whole file fits under the max). Chunks are `PUT` sequentially to the `upload_url` Init returns, each with a `Content-Range` header — no parallelism, since `MAX_POSTS_PER_RUN = 1` means only one post's video uploads per cron tick.

### 7. Scheduler UI: TikTok only offered when connected
The platform selector calls the existing `/api/connections/status` endpoint (already returns `{ youtube, tiktok }` from `connect-tiktok`); TikTok only appears as a selectable option when `tiktok: true`. This avoids letting a user schedule a TikTok post with no token to publish it with. The privacy-level dropdown (Decision 4) and the content-disclosure toggle + sub-checkboxes (Decision 4a) both appear together, conditionally, only once TikTok is the selected platform — neither renders for YouTube.

## Risks / Trade-offs

- **Optimistic completion (Decision 1) can be wrong**: a post could be marked "published" in Krakatoa while TikTok later fails it during processing (e.g., content moderation rejection). Accepted for now — no user-facing status beyond "published" exists for YouTube either at this granularity, and this keeps the change bounded. Revisit if this proves confusing in practice.
- **Compliance surface is still incomplete even with Decision 4a**: adding `privacy_level` + the two disclosure toggles covers TikTok's core, generally-applicable requirements, but is **not a guarantee of a clean App Review pass**. TikTok's guidelines include category-specific rules (e.g. regional legal disclosure text, additional requirements for certain content types) that this change does not attempt to detect or enforce. Treat this as meaningfully better review readiness, not full compliance.
- **Branded Content cannot be tested end-to-end pre-review**: because unaudited API clients are forced to `SELF_ONLY` visibility, and `brand_content_toggle = true` cannot combine with `SELF_ONLY` (Decision 4a), the "Branded Content" path is UI-visible-but-untestable until this app passes App Review. The demo recording for the review submission can only exercise "Your Brand" (organic) disclosure, not paid partnership disclosure — plan the demo script around that.
- **Sandbox visibility restrictions**: until the app passes App Review, TikTok may restrict published content visibility (e.g., to the posting Target User only) regardless of the chosen `privacy_level`. Expected, not a bug in this implementation.
- **No parallel chunk upload**: sequential PUTs are simpler but slower for large files; acceptable given `MAX_POSTS_PER_RUN = 1` and the existing `maxDuration = 60` cap on the cron route — worth revisiting if video sizes push close to the timeout.

## Alternatives Considered

- **Poll for final publish status before marking "published"** — more correct, rejected for this change's scope (Decision 1); would need a second cron pass or a queue, adding real complexity for a benefit (catching TikTok-side post-processing failures) that YouTube's integration doesn't attempt either.
- **Auto-select the most restrictive `privacy_level` instead of asking the user** — simpler, rejected because it's the exact anti-pattern TikTok's review process flags; capturing the choice at schedule time is a small UI cost for meaningfully better review odds.
- **Generic `posts.platform_publish_id` column instead of `tiktok_publish_id`** — more "future-proof," rejected: `youtube_video_id` already set the precedent of a platform-specific column, and a generic column would need a second `platform_publish_id_type` discriminator for no real benefit at 2-platform scale.
- **Single `tiktok_content_disclosure` enum (`'none' | 'your_brand' | 'branded_content'`) instead of two booleans** — considered for Decision 4a, rejected: lossy against TikTok's actual API shape, which allows both `brand_organic_toggle` and `brand_content_toggle` to be true simultaneously (e.g. a creator disclosing their own brand as a paid partnership); two nullable booleans map 1:1 to the request body with no encoding/decoding step needed at publish time.
