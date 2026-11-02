# Session handoff — YouTube publishing fixes + OAuth scope expansion

Scratch continuity doc for picking this work up in a new session. Not
project documentation — safe to delete once absorbed (don't confuse with
`CLAUDE.md`/`AGENTS.md`).

Written: 2026-10-02. Repo: `/Users/vivienchristyapriyanti/Desktop/krakatoa`
(Kelolako/Krakatoa — Next.js 15 scheduler for TikTok/Instagram/YouTube).

## Standing rules to carry forward

- **Never edit/commit on `main` directly.** Always check `git branch
  --show-current` before any edit; if uncommitted changes exist when
  switching branches, `git stash push -m "<label>" -- <files>` first
  (`git checkout -b` does NOT isolate working-tree changes by itself).
- **Create a new branch per logical change** — the user asks for this
  explicitly every time and expects it even when not restated.
- **Never commit unless explicitly asked.** The user often wants to review
  a diff first, sometimes across several turns, before saying "commit it."
- **No DB credentials assumed by default** — but `.env.local` in this repo
  *does* have real `SUPABASE_SERVICE_ROLE_KEY` / `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET` values (confirmed present, never printed). A
  throwaway diagnostic script reading them (e.g. to test a live Google API
  call) is viable with the user's explicit go-ahead — delete it immediately
  after use, confirm `git status` is clean afterward.
- **Never paste `.env.local` values.** Existence-only checks are fine.
- User mixes Indonesian/English — mirror whichever they use in a given
  message.
- The user runs multiple local Next.js projects; **`localhost` cookies are
  NOT port-scoped**, so testing across ports can leak cross-project
  session/redirect state. Also: **Supabase Auth's OAuth `redirectTo` must
  match an allowlisted Redirect URL** (Dashboard → Authentication → URL
  Configuration) or it silently falls back to the configured Site URL
  (`kelolako.com`) — this bit us when testing on a new port (3001) that
  wasn't allowlisted. Port 3000 is known-good or Supabase's redirect
  allowlist entry for it was not touched this session.
- Dev server convention used this session: `WATCHPACK_POLLING=true npx next
  dev -p <port> > /tmp/<logfile> 2>&1 &`, then poll `curl` for 200, then
  `tail` the log to confirm no compile errors. Always verify via
  `lsof -i :<port> -P -n` which process actually owns a port before
  assuming — port 3000 was briefly occupied by a **different, unrelated**
  project (`web-gmi-anugerah`, a stale 4+ day old `next-server` production
  process) which had to be killed (`kill <pid>`, done with explicit user
  confirmation) to free it for this repo.

## Git state as of writing

- `main` is at `f6ba716` (`origin/main`, in sync, nothing local-only).
- Current branch: **`youtube-channel-readonly-scope`**, merge-base == main
  tip (`f6ba716`) — **zero divergence, no rebase needed**.
- Working tree on this branch has **5 uncommitted, verified files** (see
  below) — user explicitly said "i will not commit this first" (still
  mid-testing against the live Google verification submission).
- Stash list (oldest at bottom, all still present):
  - `stash@{0}` "youtube-no-channel-connect-hint-wip" — on branch
    `youtube-no-channel-connect-hint`, 1 file
    (`ConnectionsTab.tsx`, the pre-connect nudge — see below).
  - `stash@{1}` "scheduler-platform-aware-media-limits-wip" — older,
    unrelated scheduler work, pre-dates this doc's scope, still parked.
  - `stash@{2}` "instagram-carousel-child-status-fix-wip" — same, older,
    unrelated, still parked.
- Many other local/remote branches exist from earlier sessions (see `git
  branch -vv`) — not touched this session, listed for awareness only.

## Completed and merged (nothing further needed)

1. **Facebook domain verification meta tag** — `app/layout.tsx`'s `metadata`
   export, `other: { 'facebook-domain-verification': '...' }`. Branch
   `add-facebook-domain-verification`, merged via PR #205.
2. **Scheduler connection-gating fixes** (branch
   `scheduler-connection-gating-fix`, PR #206, merged):
   - YouTube checkbox no longer preselects/shows when disconnected
     (`youtubeConnected` threaded through `PlatformFields`,
     `makeDraft()`'s `platforms` default changed from `["youtube"]` to
     `[]`).
   - Removed the redundant Instagram "posting as @username" panel (the
     "Connected accounts" row already shows this via
     `ConnectionStatusBadge`).
   - Added per-platform capability subtext under each platform checkbox
     (YouTube "Video only", TikTok/Instagram carousel-size hints), matching
     an earlier throwaway prototype's pattern.

## In-flight branches (not merged, not pushed unless noted)

### `youtube-no-channel-error-message` — committed + pushed, PR not opened

Commit `41e92fd` on top of `main` at the time (now behind current `main` by
a few commits, but no conflicts expected — only touches `lib/youtube.ts`).
Root cause fixed: a real production incident where
`kelolakotesting@gmail.com` reconnected YouTube (token genuinely valid) but
every publish attempt failed with a bare `"Unauthorized"` — root cause was
that Google account **never having a YouTube channel created**, not a
token/auth problem. `uploadToYouTube()` now distinguishes:
- 401 on token refresh → "YouTube access has expired or was revoked. Please
  reconnect YouTube in Settings."
- 401 on the upload call itself (refresh succeeded) → "This almost always
  means the connected Google account has no YouTube channel yet — create
  one at youtube.com, then retry this post..."

Both preserve `response.status = 401` via a `youtubeAuthError()` helper so
`lib/cron-publish-pure.ts`'s `isPermanentFailure` still fails fast instead
of uselessly retrying.

**Action needed**: open the PR —
`https://github.com/krakatoateams/krakatoa/pull/new/youtube-no-channel-error-message`

### `youtube-no-channel-connect-hint` — built, STASHED, not committed

`stash@{0}` holds one file: `ConnectionsTab.tsx` with a small nudge line
under the YouTube connect row (shown only when disconnected): *"Needs an
existing YouTube channel on that Google account — create one at
youtube.com first if you don't have one yet."* Verified via `tsc`/`eslint`
at the time. Superseded in spirit (but not code) by the fuller
connect-time detection built on `youtube-channel-readonly-scope` below —
**decide whether to still land this standalone, drop it, or fold it in**
before popping the stash.

### `youtube-channel-readonly-scope` — current branch, built, NOT committed

This is the big one. Built in response to: "show the connected YouTube
account's channel name, like TikTok/Instagram already do." Grilled
extensively; **empirically confirmed** (live test against
`kelolakotesting@gmail.com`'s real stored token) that `youtube.upload`
alone cannot call `channels.list` — Google returns `403: insufficient
authentication scopes`. So `youtube.readonly` is genuinely required, no way
around it.

**5 uncommitted files, all verified clean via `tsc --noEmit` + `eslint` +
the `youtube-oauth-pure` self-check** (`npm run test:youtube-oauth`):

1. `app/api/connections/youtube/start/route.ts` — scope array now requests
   both `youtube.upload` and `youtube.readonly`.
2. `lib/youtube.ts` — new `getYouTubeChannelTitle(refreshToken)`: calls
   `channels.list(mine=true)`, returns the title or `null` (confirmed:
   `null` means "this account genuinely has no channel" — the same root
   cause as the no-channel-error-message branch above).
3. `app/api/connections/youtube/callback/route.ts` — after saving the
   token (unchanged core upsert logic), best-effort fetches the channel
   title: found → stored in `platform_tokens.username` (same column
   TikTok/Instagram already use); not found → redirects with
   `&warning=youtube_no_channel` (connection still succeeds, this is just
   a heads-up, not a failure).
4. `app/api/connections/status/route.ts` — stale-comment-only fix; this
   route already generically returned `usernames.youtube`, it just had
   nothing writing to it until now.
5. `app/(app)/dashboard/settings/ConnectionsTab.tsx` — shows the channel
   name under "YouTube" once connected (parity with TikTok/IG); new amber
   warning banner (distinct from the red error banner) for the no-channel
   case; a **"Reconnect" button** appears next to "Connected" whenever
   `youtubeUsername` is null — covers both "connected before
   `youtube.readonly` existed" and "connected after, but genuinely has no
   channel," since the advice converges either way. Reconnecting doesn't
   require disconnecting first (callback upserts in place).

`ConnectionStatusBadge.tsx` (the Scheduler page's "Connected accounts"
pill) needed **zero changes** — it already reads `usernames[platform]`
generically.

**Deliberately NOT done**: no code-level environment gate to stop the
production deployment from requesting `youtube.readonly` for real users.
This was offered twice (to protect Google's non-resettable, lifetime
**100-user OAuth cap** for unapproved sensitive scopes — currently at
6/100 used) but never actually built — **still an open offer, not yet
accepted or declined**. Worth raising again before this branch is merged
to `main` and deployed, since right now `start/route.ts` unconditionally
requests both scopes with no environment check.

## The Google OAuth verification saga — current status

- Project: Google Cloud "autopilot-scheduler", OAuth client used in
  `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`.
- Publishing status: **"In production"** (confirmed, not "Testing" — so
  there is no test-user allowlist mechanism available; corrected an earlier
  wrong assumption mid-session).
- `youtube.upload`: already verified (green check).
- `youtube.readonly`: added to the consent screen's sensitive-scopes list,
  justification text written and saved (see below), **verification
  request already submitted by the user** as of this doc.
- **OAuth user cap**: 100 users, lifetime, non-resettable, for unapproved
  sensitive/restricted scopes — currently 6/100 used. Testing consumes
  from this same shared pool regardless of localhost vs production, which
  is exactly why Google's own UI explicitly warns against deploying an
  unverified scope to real production traffic.
- **Quota correction made this session**: an earlier assumption (and a
  comment in `openspec/changes/scheduler-cron-reliability/design.md`) said
  YouTube uploads are capped at ~6/day app-wide (10,000 daily quota ÷ 1,600
  units per `videos.insert`). **This is now stale** — confirmed via
  Google's current official docs (`developers.google.com/youtube/v3/determine_quota_cost`)
  that `videos.insert` moved to its own separate bucket, **100 calls/day,
  1 unit each**, as of a June 2026 Google change. The real ceiling today is
  **~100 uploads/day app-wide**, not 6. That openspec doc's comment is now
  inaccurate and could mislead a future reader — consider fixing it.
- **Successfully tested the incremental-consent flow** on `localhost:3000`
  with `christyvivien@gmail.com`: Google correctly showed "Kelolako wants
  additional access" (just the new `youtube.readonly` scope, since
  `youtube.upload` was already granted previously) plus the expected
  "Google hasn't verified this app" warning. This is exactly what Google's
  own Data Access page said the demo video needs to show.
- A demo-video narration script was written and handed to the user
  (see chat history around "Scope requested: youtube.upload — to publish
  videos... youtube.readonly — to...") — not reproduced in full here, but
  covers: what each scope is for, then walking through connect → consent
  (with the unverified warning) → channel name appearing in Settings.
- **Current state**: user has recorded and submitted the verification
  request. **Outcome/timeline unknown** — Google publishes no SLA for this
  review (expect weeks, not days, per earlier research). No action needed
  from us while waiting.

## Open decisions for next session

1. **Env-gate `youtube.readonly`** in `start/route.ts` before merging
   `youtube-channel-readonly-scope` to `main`? (Protects the 100-user cap
   from real production traffic until Google approves.) User hasn't said
   yes or no yet — ask again.
2. **What to do with the stashed `youtube-no-channel-connect-hint` nudge**
   — land standalone, drop, or fold into the bigger branch's UI.
3. **Open the `youtube-no-channel-error-message` PR** — built and pushed,
   just needs a PR opened on GitHub (no `gh` CLI available in this
   environment; must be done via the web UI link above or by the user).
4. **Rollout strategy for turning YouTube on for all users** (separate from
   the scope work): earlier grilled decision was staged rollout via the
   `tool_preview_access` platform-scoped allowlist first, not a global
   `platform_availability.youtube.enabled = true` flip — this was never
   executed, still pending. Toggle lives at `/admin/config-v2` → Schedule
   tool section → "Platform availability" checkboxes (confirmed working,
   admin-only, takes effect live, no deploy needed).
5. **Once Google approves `youtube.readonly`**: remove/flip the env gate
   (if built per #1), merge `youtube-channel-readonly-scope` to `main`,
   deploy. Existing connected users will see the "Reconnect" button until
   they reconnect.
6. Consider fixing the now-stale quota comment in
   `openspec/changes/scheduler-cron-reliability/design.md` (6/day → actual
   current ~100/day figure).

## Dev servers

Both `localhost:3000` (krakatoa, currently running,
`/tmp/kelolako-dev-3000.log`) should be checked for whether they're still
needed/running at the start of the next session — `lsof -i :3000 -P -n` to
confirm, don't assume still alive.
