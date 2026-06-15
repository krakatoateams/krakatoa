## Context

`uploadToYouTube` (`lib/youtube.ts`) sets `status.privacyStatus: "unlisted"` for every `videos.insert`. The cron (`app/api/cron/route.ts`) calls it per due post; `POST /api/posts` (`app/api/posts/route.ts`) inserts rows into the legacy `posts` table (evolved additively in migration 003). Phase 1 stores format only in client `VideoItem` state and appends `#Shorts` to a Short's description client-side before posting.

Empirical finding: existing app uploads appear as **Unlisted** in YouTube Studio — exactly what the code requests — so the API is honoring requested visibility and is not applying the unverified-project "force private" lock. Therefore `"public"` is expected to take effect immediately.

## Goals / Non-Goals

**Goals:**
- Scheduled uploads publish as **public**.
- Persist each post's **format** (`short` / `video`) for tracking/analytics.

**Non-Goals:**
- No per-post privacy selector (global only).
- No move of `#Shorts` tagging to the server (kept client-side; it works and is idempotent).
- No OAuth verification or YouTube API audit work (unrelated to publishing public at current scale).
- No backfill of `format` for historical posts (legacy = `null`).

## Decisions

### 1. Global flip, hardcoded `"public"`
Single-line change `"unlisted"` → `"public"` in `uploadToYouTube`. No env toggle, no per-post column — the product intent is always public, per the product owner. Keeps the surface minimal.

### 2. `posts.format` is a nullable text column
`format text` with allowed values `'short' | 'video'` (enforced in the API layer, not a DB CHECK, to match the repo's additive/idempotent migration style and avoid re-run friction). Nullable so existing rows remain valid and clearly mark "unknown/legacy". Indexing is unnecessary at this scale.

### 3. API validates then stores
`POST /api/posts` reads `format`, accepts only `"short"`/`"video"` (anything else → omit the column, insert `null`). Additive to the existing `insertRow` builder; never fails the request over a bad format.

### 4. Client sends the already-known format
The scheduler already holds `format` per `VideoItem` (Phase 1). Single mode posts `item0.format` via `ScheduleCard`; bulk posts `it.format` in `handleScheduleAll`. The `#Shorts` description append stays exactly as Phase 1 left it — the column is additive tracking, orthogonal to the description tag.

## Risks / Trade-offs

- **Public-by-default is irreversible per upload.** Once cron publishes, the video is public. Mitigated by the Unlisted-honored evidence and a manual verify step (schedule one real post, confirm it lands Public). If a softer rollout is ever wanted, a per-post selector is the documented future path.
- **Redundancy** between `posts.format` and the `#Shorts` description tag is intentional: the column is for analytics/source-of-truth; the tag is for YouTube discovery. Consolidating (#Shorts server-side from `format`) is deferred.
- **Unverified app cap (100 users)** is untouched — fine at current scale; revisit when onboarding broadly.

## Alternatives Considered

- **Per-post privacy selector** — more control, but rejected by the product owner (creators always want public) and adds UI + column + cron pass-through.
- **DB CHECK constraint on `format`** — stricter, but conflicts with the idempotent re-runnable migration convention; API-level validation is sufficient.
- **Env-configurable privacy** — flexible for preview environments, but over-engineered for "always public"; skipped.
