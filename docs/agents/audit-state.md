# Repository audit state

- Runbook: `docs/agents/code-security-audit-runbook.md`
- Runner: `/audit-repo`
- Execution mode: `auto-fix-and-merge`
- Overall status: `in_progress`

The runner owns only branches prefixed `audit-repo/`. It may commit on those
branches, open a GitHub pull request, merge with a merge commit (never squash,
rebase, or fast-forward onto `main`), pull the merge onto local `main`, and
delete those branches after every quality gate passes. It never commits on
`main` or pushes `origin/main` directly. It pauses for the stop conditions in
the runbook.

## Active slice

None.

## Queue

- [x] Identity: authentication and session resolution
  - [x] Supabase Auth session lifecycle and product-profile resolution
- [x] Authorization: admin guards and service-role ownership checks
  - [x] Admin guards (pages, `withAdmin`, feature gates)
  - [x] Unauthenticated service-role provider routes (`generate-caption`,
        `test-stitch`)
  - [x] Service-role `profile_id` ownership on user APIs
    - [x] Canvas and editor CRUD
    - [x] Owned skills CRUD
    - [x] Welcome-offer claim auth + posts PATCH ownership
  - [x] Service-role `user_id` ownership (creations, connections; storage
        signing stays with the Storage queue item)
- [x] Credits: ledger, pricing, bonus offers, and refund policy
  - [x] Refund after provider commit (leftover canvas-text / reconcile)
  - [x] Ledger RPC, wallets, lots, expiry
  - [x] Pricing resolver and admin knobs
  - [x] Welcome/bonus claim races
- [x] Payments: DOKU checkout, callbacks, signatures, and replay handling
  - [x] Webhook HMAC + amount binding
  - [x] Checkout + owner-scoped reconcile
- [x] Storage: upload/read signing, canonical paths, cleanup, and egress
  - [x] Read-sign core (path/assetId ownership + signed-URL cache)
  - [x] TikTok photo proxy
  - [x] Device upload signing
  - [x] Generation-ref upload signing
  - [x] Client egress (stable URLs, next/image)
  - [x] Cross-tool mention / creation-ID resolution
  - [x] History batch signing
  - [x] Pipeline server-side signing
  - [x] Publish/cron signing
  - [x] Canonical path layout
  - [x] Sweep / orphans
  - [x] Resumable recovery staging
  - [x] Creation expiry cleanup
  - [x] Platform skill thumbs
- [x] Integrations: TikTok OAuth, callbacks, tokens, and publishing
  - [x] TikTok OAuth, callbacks, and token lifecycle
  - [x] TikTok publish client (`lib/tiktok.ts`; cron stays Scheduler)
- [x] Integrations: Google/YouTube OAuth, tokens, and publishing
  - [x] YouTube OAuth, callbacks, and token lifecycle
  - [x] YouTube upload client (`lib/youtube.ts`; cron stays Scheduler)
- [x] Integrations: Instagram OAuth, callbacks, and token lifecycle
  (discovered; same `platform_tokens` / connections family)
  - [x] Instagram OAuth, callbacks, and token lifecycle
  - [x] Instagram publish client (`lib/instagram.ts`; cron stays Scheduler)
- [ ] Scheduler: posts, retries, concurrent publication, and cron protection
  - [x] Posts API: create, list, and mutate
  - [x] Publisher cron: claim, idempotency, retries, concurrent runs
  - [x] Failed-post storage cleanup cron
  - [x] Scheduler composer UI: schedule, bulk retry, TikTok preflight
  - [x] In-app calendar UI: edit, cancel, drag-reschedule
  - [x] Cross-tool handoff and dashboard reads
  - [ ] Legacy public calendar (`/calendar`)
- [x] Database: RLS, RPC grants, constraints, and security advisors
  - [x] Reconcile the live Supabase Auth FK cutover with an idempotent
    `supabase/migrations/` record; production is aligned but migration `003`
    and the deferred script do not reproduce that final state safely.
  - [x] RPC EXECUTE grants (PUBLIC default vs service_role-only)
  - [x] Legacy / untracked tables (RLS + schema lineage for posts,
        platform_tokens, storyboards, users_deprecated)
  - [x] Migration catalog integrity (duplicate prefixes, stale `FROM users`
        backfills, 001–003 bootstrap)
  - [x] Live Supabase security advisors
- [ ] Admin: configuration, monitoring, prompt exposure, and log redaction
- [ ] Public/deployment: auth UI, redirects, headers, dependencies, and secrets

## Completed

### Generation platform and Video Studio

- Date: 2026-09-11
- Audited through: `5ab6114`
- Scope: metered generation, workflow settlement, client submit core,
  Video/Photo/Skill composers, deep links, active-composer lifecycle, shared
  history, and preview actions.
- Verification: focused generation/studio tests, lint, production build, and
  repeated security reviews.
- Result: no unresolved blocking Standards, Spec, or security finding in scope.

### Identity: Supabase Auth session and profile resolution

- Date: 2026-09-11
- Base: `abbf1496dd7b7038aecf276b9ffa87683e10d8bb`
- Final commit: `7c6893edfa9e881f1fbbbf3bdc928947aaf8917f`
- Scope: Supabase browser/server clients, auth context, password and OAuth entry
  routes, middleware session refresh, safe redirects, session-user and product
  profile resolution, login lockout evidence, and live identity-ID alignment.
- Findings: fixed password sign-in auth-context desynchronization; blocked
  protocol-relative and backslash-normalized external redirects; preserved
  Supabase auth cookies and anti-cache headers on middleware redirects; marked
  auth entry responses private/no-store; corrected stale NextAuth documentation.
- Accepted risks: `createSupabaseAuthServer()` cannot attach response headers
  directly, but its current readers are dynamic through `cookies()` and the
  session-establishing routes explicitly use private/no-store. Provider
  enumeration and fail-open lockout storage remain documented, rate-limited
  product tradeoffs.
- Follow-up: formalize the already-live `auth.users` FK cutover during the
  Database audit; live read-only checks found 21/21 profiles and 158/158
  creations aligned, no legacy-ID rows, and no case-only/duplicate profile
  emails.
- Verification: `npm run test:auth`, `npm run test:video-studio`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`, and
  `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Authorization: admin guards

- Date: 2026-09-12
- Base: `85afb7743b2b49b29eee73b13e4e8a979d41daf5`
- Final commit: `000e3190fdf34df0ea02f7e1a7e3b3d0a94540df`
- Scope: `lib/admin-auth.ts`, `lib/admin-api.ts`, `lib/admin-users-db.ts`,
  `lib/admin-auth-pure.ts`, `app/(app)/admin/layout.tsx`, `app/api/admin/**`,
  feature-level `getCurrentAdmin()` gates, and
  `supabase/migrations/090_atomic_admin_revoke.sql`.
- Findings: unknown-admin DELETE now returns 404 via `AdminNotFoundError`;
  last-admin revoke is serialized by `krakatoa_revoke_admin` (applied live as
  `atomic_admin_revoke`). All 36 mutating admin APIs already used `withAdmin()`;
  `/api/admin/me` remains cosmetic.
- Accepted risks: missing-RPC fallback still uses check-then-update (production
  has the RPC). Admin identity is keyed on `profiles.email`; auth-email drift
  is latent until an email-change flow exists. `owner` vs `admin` is display
  only. Infra-null profile from `getCurrentProfile()` maps to 401, matching
  Identity.
- Follow-up: service-role `profile_id` and `user_id` ownership slices remain.
- Verification: `npm run test:admin-auth`, `npm run test:auth`,
  `npm run test:monitoring-flags`, `npm run lint` (0 errors; 11 pre-existing
  warnings), `npm run build`, and `git diff --check` passed. Live RPC
  `not_found` and service-role-only EXECUTE grants verified.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Authorization: unauthenticated service-role provider routes

- Date: 2026-09-12
- Base: `1a9707fc702c66eb908ee74c56afb9455d9459e5`
- Final commit: `75096cad12ef11afb50ecd35688de32ce198a4d6`
- Scope: `app/api/generate-caption/route.ts`, `app/api/test-stitch/route.ts`,
  `lib/provider-route-auth-pure.ts`.
- Findings: caption `general`/`polish`/text-only modes now require a session
  (401) before Replicate/Rendi; `test-stitch` is admin-gated via `withAdmin()`.
- Accepted risks: caption remains unmetered for authenticated users.
  Authenticated callers may still pass an external `videoUrl` to Rendi (scheduler
  hosted-URL flow). Storage signing stays with the Storage queue item.
- Verification: `npm run test:provider-route-auth`, `npm run test:admin-auth`,
  `npm run test:auth`, `npm run lint` (0 errors; 11 pre-existing warnings),
  `npm run build`, and `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Authorization: profile_id ownership

- Date: 2026-09-12
- Base: `f4d338c186f2dcf4f82748b188377a2a11c2843d`
- Final commit: `2bb774754cdcf8a619f353c24885fd1c8e0eb632`
- Scope: canvas/editor/skills CRUD (review-only),
  `app/api/welcome-video-offer/claim/route.ts`, `app/api/posts/[id]/route.ts`.
- Findings: welcome-offer claim now returns 401 when unauthenticated; posts
  PATCH owner-checks `profile_id` on read and on the update filter. Canvas,
  editor, and owned skills already scoped every query by session `profile.id`.
- Accepted risks: posts wrong-owner stays 403 after fetch-by-id (existence
  leak of a UUID). Welcome GET still returns `{ eligible: false }` for
  unauthenticated readers. Generation `profile_id` routes were already audited.
- Follow-up: unauthenticated `POST /api/posts` without storage linkage, and
  publish TOCTOU on PATCH vs cron claim, belong to Scheduler.
- Verification: `npm run test:post-ownership`, `npm run test:canvas`,
  `npm run test:editor`, `npm run test:skills`, `npm run lint` (0 errors;
  11 pre-existing warnings), `npm run build`, and `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Authorization: user_id ownership

- Date: 2026-09-12
- Base: `89606a95fcbfef1e5b721cb237190733e3cd7984`
- Final commit: `c5edfa0dfef4c1190c7ffc973af814d7c6699eaa`
- Scope: `app/api/creations/[id]/route.ts`, `lib/creations-db.ts`, plus
  review-only connections, storyboards list, product-photo history, and
  creations history/trash.
- Findings: rename/restore/trash of a missing or foreign creation now
  returns 404 instead of 500. Connections, history, and list routes already
  scoped every query to session `user_id`.
- Accepted risks: select-time DB errors in `updateUserCreation` map to 404
  except missing-table. Storage signing stays with the Storage queue item.
  OAuth CSRF stays with Integrations.
- Verification: `npm run test:creation-ownership`,
  `npm run test:creation-item-actions`, `npm run test:animate-handoff`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`, and
  `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Credits: refund after provider commit

- Date: 2026-09-12
- Base: `b773548678c1083b9f050d6559ecafb3edd87c22`
- Final commit: `00c44a53143742f29b34e5960f97ac16e6acc535`
- Scope: `app/api/generate-canvas-text/route.ts`,
  `lib/generation-reconcile.ts`, `lib/generation-commit-pure.ts`.
- Findings: leftover canvas-text catch and legacy reconcile no longer refund
  after `cancel_allowed=false`.
- Accepted risks: if `markProviderCommitted` itself fails after Replicate
  success, refund may still run. Reconcile with no generation request still
  refunds (pre-commit-era jobs). User credit read routes already bind to
  session `profile.id`; admin set/grant stay admin-wallet-only.
- Follow-up: welcome claim vs first-job TOCTOU; optional `Date.now()` spend
  keys when canvas-text has no job id; pricing zero-amount admin knobs.
- Verification: `npm run test:generation-commit`,
  `npm run test:recoverable-refund`, `npm run test:metered-generation`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`, and
  `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Credits: ledger, pricing, and welcome offers

- Date: 2026-09-12
- Base: `3805f4d9d0700aa58e4c7baf018d3946cc18ea3d`
- Final commit: unchanged (review-only)
- Scope: `app/api/credits/{balance,transactions,lots}`,
  `app/api/admin/credits/{set,grant-bonus}`, `lib/pricing-resolver.ts`,
  `lib/welcome-video-offer.ts`.
- Findings: none requiring a code change. User ledger reads bind to session
  `profile.id`. Admin set/grant reject non-admin wallets. Resolver fails
  closed on unknown keys.
- Accepted risks: admin may set `credit_amount: 0` on non-video keys.
  Welcome claim vs first-job TOCTOU remains; idempotency prevents
  double-grant only. Durable fix is an atomic claim RPC.
- Verification: review-only; neighboring credit tests already green on
  `3805f4d`.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Payments: DOKU checkout, webhook, and reconcile

- Date: 2026-09-12
- Base: `3805f4d9d0700aa58e4c7baf018d3946cc18ea3d`
- Final commit: `4609b329d7a5fd24a874816661576c8c30bb250c`
- Scope: `app/api/payments/doku/webhook/route.ts`,
  `lib/credit-fulfillment.ts`, `lib/doku.ts`,
  `app/api/credits/checkout/route.ts`, `app/api/credits/orders/[id]/route.ts`.
- Findings: reconcile no longer fulfills a SUCCESS when DOKU amount is
  missing; webhook and reconcile share `dokuPaidAmountMatchesOrder`.
  Checkout still takes only `packId`; webhook HMAC remains fail-closed.
- Accepted risks: no `Request-Id` / timestamp replay store (ledger
  idempotency is the backstop). Amount mismatch on webhook returns 200 so
  DOKU stops retrying (user poll can still fulfill). `Client-Id` is not
  rebound to env.
- Follow-up: `scripts/reconcile-doku-orders.mjs` still fail-opens on a
  missing amount and uses a single purchase key.
- Verification: `npm run test:doku-fulfillment`, `npm run lint`
  (0 errors; 11 pre-existing warnings), `npm run build`, and
  `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Storage: read-sign core

- Date: 2026-09-12
- Base: `d17ee3ec27222fb624d5c8b4acf5941beef00681`
- Final commit: `caa9d12155fedcd34025b52eaff5cd0e9bff7bf1`
- Scope: `GET /api/storage/sign`, `POST /api/storage/sign-batch`,
  `lib/storage-signed-url.ts`, `lib/storage-sign-ownership-pure.ts`,
  `getAssetForProfile` (review-only), migration `060` cache contract.
- Findings: DB-reference fallback no longer treats a signed-URL substring as
  ownership of a different key; PostgREST `.or()` no longer interpolates raw
  paths. Prefix ownership, session 401, foreign `assetId` 404, and exact UI TTL
  cache were already correct.
- Accepted risks: same-owner soft-deleted assets remain signable via `assetId`
  (`getAssetForProfile` has no `deleted_at` filter; trash is still owner media).
  Cache is path-keyed after ownership. `ilike` candidate fetch is capped at 20
  and fail-closed. `createSignedStorageUrl` without a session stays with
  publish/pipeline/skill-thumb slices.
- Follow-up: TikTok photo proxy, upload signing, client egress, mention
  resolution, history/pipeline/publish signing, sweeps, and skill thumbs remain
  in the Storage queue. Pipeline `resolveRefForPipeline` HTTP fallback stays
  with pipeline signing.
- Verification: `npm run test:storage-sign-ownership` (red on suffix grant,
  then green), `npm run test:creation-ownership`,
  `npm run test:animate-handoff`, `npm run test:post-ownership`,
  `npm run test:creation-item-actions`, `npm run test:video-studio`,
  `npm run probe:signed-url-cache`, `npm run lint` (0 errors; 11 pre-existing
  warnings), `npm run build`, and `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Storage: TikTok photo proxy

- Date: 2026-09-12
- Base: `5acd8590cea554683ed236efca11845bee121fee`
- Final commit: `344514f74222fc51e4963a85c8ef432d27a40aa2`
- Scope: `app/api/tiktok-photos/[...path]/route.ts`,
  `photoProxyStorageCandidates`, `toProxyPhotoUrl` / path rewrite.
- Findings: proxy now tries user-first `{userId}/photos/…` then advertised
  legacy `photos/{userId}/…`. Traversal and non-photos roots already rejected.
- Accepted risks: unauthenticated `photos/`-prefix fetch is required for TikTok
  `PULL_FROM_URL` (OpenSpec). A leaked UI signed URL still reveals a durable
  proxy path; HMAC/post-binding would be a product change. `Cache-Control:
  public, max-age=3600` is intentional for the puller.
- Follow-up: device upload signing and remaining Storage slices stay queued.
- Verification: `npm run test:tiktok-photo-proxy` (red on missing legacy key,
  then green), `npm run test:storage-sign-ownership`,
  `npm run test:tiktok-creator-info`, `npm run test:post-ownership`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`, and
  `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Storage: upload signing (device + generation-ref)

- Date: 2026-09-12
- Base: `a31855818bb4d6b7ddd2ded1bd23aa37d99fd16c`
- Final commit: unchanged (review-only)
- Scope: `POST /api/upload/sign`, `POST|DELETE /api/upload/ref/sign`,
  deprecated `POST /api/upload`, scheduler/ref path builders.
- Findings: none requiring a code change. Paths are server-chosen under
  `{userId}/`; filenames are sanitized; ref DELETE is prefix-gated and rejects
  nested segments. Legacy multipart upload remains 410.
- Accepted risks: MIME and size are validated from client claims at sign time
  and are not bound into the Storage upload token. Same-tenant oversize or
  type mismatch is possible within bucket limits.
- Follow-up: remaining Storage slices (client egress, mentions, history,
  pipeline/publish signing, canonical layout, sweeps, resumable, expiry,
  skill thumbs).
- Verification: review-only; neighboring `npm run test:storage-sign-ownership`
  and `npm run test:tiktok-photo-proxy` already green on `a318558`.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Storage: client egress

- Date: 2026-09-12
- Base: `9373229e6b118b2493e4b39ded87e481e269c77a`
- Final commit: unchanged (review-only)
- Scope: `lib/use-signed-media-url.ts`, `lib/storage-sign-client.ts`,
  `next.config.mjs` image optimizer, `CreationsHistory` / `CreationPreviewModal`.
- Findings: none. UI default TTL is cacheable `ui`; `MAX_REFRESH_MS` clamps
  `setTimeout`; library/preview use `next/image` without `unoptimized`.
- Accepted risks: scheduler post cards still use raw `<img>` (documented in
  `docs/ops/supabase-egress.md`). History URLs are not client-refreshed for
  tabs open longer than the 30-day UI TTL.
- Follow-up: remaining Storage signing and lifecycle slices.
- Verification: review-only; repo grep found zero `unoptimized`.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Storage: mentions, history, pipeline, and publish signing

- Date: 2026-09-12
- Base: `e68e7bb93969a461f1c409628aaccd81188bb098`
- Final commit: `f67316b`
- Scope: `resolveMentionCreations`, `signCreationItemsMedia`, pipeline
  `signStoragePathForPipeline` / `resolveRefForPipeline`, cron publish
  signing, `POST /api/posts` `photo_urls`.
- Findings: mentions, history, and pipeline already owner-scope before sign.
  Photo posts could persist and publish-sign another user's path; schedule
  now classifies + asserts ownership, and cron re-asserts before conversion
  and `signOwnedStoragePathForPublish`.
- Accepted risks: pipeline HTTP fallback after a missing owned object, and
  raw http `video_url` publish, remain hosted-URL flows. Trashed own
  creations can still be mentioned.
- Follow-up: remaining Storage lifecycle slices (canonical, sweep,
  resumable, expiry, skill thumbs).
- Verification: `npm run test:storage-sign-ownership` (red then green),
  `npm run test:post-ownership`, `npm run test:animate-handoff`,
  `npm run test:creation-ownership`, `npm run lint` (0 errors; 11
  pre-existing warnings), `npm run build`, and `git diff --check` passed.
- Security: 0 critical, 0 high, 0 unaccepted medium. Low cron-ordering
  finding fixed in the same slice.

### Storage: canonical paths, sweep, resumable, expiry, and skill thumbs

- Date: 2026-09-12
- Base: `5fceccc574fca48c8e425888485a2bd9eff111a7`
- Final commit: `d3140e90b4f3b1a3726cf080d7428dec94881075`
- Scope: `lib/storage-buckets.ts`, `lib/storage-paths.ts`,
  `lib/storage-sweep.ts`, `lib/storage-orphan-audit.ts`,
  `lib/pipeline-recovery/storage.ts`, `lib/creation-expiry.ts`,
  cron sweep/expiry routes, skill thumb upload routes.
- Findings: daily sweep listed `{userId}/resumable/` as `videos` and treated
  child artifacts as orphans; prefix-only job refs do not protect them.
  Classifier now keeps resumable paths (reconcile/settlement purge). Canonical
  builders, expiry, cron auth, and skill-thumb gates needed no code change.
- Accepted risks: sweep remains videos-only (photos audit-only). `CRON_SECRET`
  open when unset. Expiry deletes `storage_path` without a prefix-vs-`user_id`
  assert (no client write path to that column). User custom thumbs write
  `platform/skills/{slug}/`; `createSignedStorageUrl` without a user prefix is
  by design for that tree. Abandoned resumable folders wait for reconcile.
- Follow-up: paginate `collectStorageReferences` / expiry selects before
  PostgREST's ~1000-row default matters; optional expiry ownership assert;
  unused prior thumb objects under `platform/skills/`.
- Verification: `npm run test:storage-sweep` (red on resumable orphan, then
  green), `npm run test:storage-sign-ownership`,
  `npm run test:tiktok-photo-proxy`, `npm run test:creation-ownership`,
  `npm run test:animate-handoff`, `npm run test:post-ownership`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`, and
  `git diff --check` passed.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Database: Auth FK cutover

- Date: 2026-09-12
- Base: `687d79c1ed3a8b183ff6da0dcb91a8007d50d188`
- Final commit: `96b408fa852dfb308b0dacc466ee755dde55135a`
- Scope: `supabase/migrations/091_auth_users_fk_cutover.sql`, guards on
  `001`/`003`, superseded remap script, `lib/auth-users-fk-cutover-pure.ts`.
- Findings: live FKs already pointed at `auth.users` (21/21 profiles, 159/159
  creations, 0 orphans). Added an idempotent no-op-on-prod record; `001` no
  longer recreates `product_photo_generations` after `users` is gone; `003`
  skips the NextAuth backfill; deferred email-rematch script now raises.
- Accepted risks: 091 does not rewrite `ON DELETE` when an FK already targets
  `auth.users` (production posts stay CASCADE). Greenfield `002`/`003`
  `CREATE … REFERENCES users` remains catalog-integrity work.
- Verification: `npm run test:auth-users-fk` (red then green),
  `npm run test:auth`, `npm run test:creation-ownership`,
  `npm run test:post-ownership`, `npm run lint` (0 errors; 11 pre-existing
  warnings), `npm run build`, and `git diff --check` passed. MCP applied
  `auth_users_fk_cutover`; FKs and leftover tables unchanged.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Database: RPC EXECUTE grants

- Date: 2026-09-12
- Base: `6167c97e876f2a2c0e8f25a177116344cb78a143`
- Final commit: `81e3bc67475d02a77b76112118cfb0724eedba4b`
- Scope: `supabase/migrations/092_krakatoa_rpc_grants.sql`,
  `lib/rpc-grant-lockdown-self-check.ts`.
- Findings: live `EXECUTE` on `krakatoa_apply_credit_transaction` (both
  overloads), `expire_credit_lots`, `seed_initial_credits`, and
  `set_updated_at` still included anon/authenticated via PUBLIC. 092 revokes
  PUBLIC on every `public.krakatoa_*` function and grants `service_role`.
- Accepted risks: functions remain SECURITY INVOKER; `CREATE OR REPLACE`
  re-grants PUBLIC unless a later migration repeats the lock. Leftover
  10-arg credit-RPC overload is now locked but still present (catalog).
- Verification: `npm run test:rpc-grants` (red then green),
  `npm run test:auth-users-fk`, `npm run test:admin-auth`, `npm run lint`
  (0 errors; 11 pre-existing warnings), `npm run build`, and
  `git diff --check` passed. MCP applied `krakatoa_rpc_grants`; every
  `krakatoa_*` function is service_role-only.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Database: legacy RLS policies and security advisors

- Date: 2026-09-12
- Base: `5b929670a21b5241eddd8d69c44711df3dcb139c`
- Final commit: `f24159925beb5c43323273a8ff12d3fe67c46cba`
- Scope: `supabase/migrations/093_deny_by_default_legacy_policies.sql`,
  `lib/deny-by-default-rls-self-check.ts`.
- Findings: live `storyboards` had anon SELECT USING true; `posts` and
  `platform_tokens` had own-row FOR ALL; `users_deprecated` had a leftover
  NextAuth policy; `rls_auto_enable()` was SECURITY DEFINER + PUBLIC
  EXECUTE. 093 drops those policies and locks the helper.
- Accepted risks: INFO `rls_enabled_no_policy` on all public tables is the
  deny-by-default model. WARN leaked-password protection is an Auth
  dashboard setting (Public/deployment). CREATE TABLE lineage for
  `platform_tokens` / `posts` / `storyboards` stays catalog work.
- Verification: `npm run test:deny-by-default-rls` (red then green),
  `npm run test:rpc-grants`, `npm run test:post-ownership`,
  `npm run test:auth`, `npm run lint` (0 errors; 11 pre-existing
  warnings), `npm run build`, and `git diff --check` passed. MCP applied
  `deny_by_default_legacy_policies`; four tables have RLS + 0 policies;
  `rls_auto_enable` is service_role-only; advisor WARN for that function
  is gone.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Database: migration catalog integrity

- Date: 2026-09-12
- Base: `065045f`
- Final commit: `1f9e39f895b8929d8d5b6d5cc50ccee7e94acd97`
- Scope: `002`/`003` identity FKs, removed duplicate
  `076_tool_preview_access 2.sql`, `094_drop_legacy_credit_rpc_overload.sql`.
- Findings: early CREATE still targeted `public.users`; an identical 076
  file would re-apply via `db:setup`; a leftover 10-arg credit RPC
  overload survived 050. Catalog now points identity FKs at `auth.users`
  and keeps one lot-aware credit RPC.
- Accepted risks: duplicate numeric prefixes remain (lexicographic apply
  order). `001` still creates `product_photo_generations` only when
  `public.users` exists. Untracked CREATE for `posts` / `platform_tokens`
  / `storyboards` is historical — live tables already exist.
- Verification: `npm run test:migration-catalog` (red then green),
  `npm run test:auth-users-fk`, `npm run test:rpc-grants`, `npm run lint`
  (0 errors; 11 pre-existing warnings), `npm run build`, and
  `git diff --check` passed. MCP applied `drop_legacy_credit_rpc_overload`;
  only the 12-arg credit RPC remains, service_role-only.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Integrations: TikTok OAuth and token lifecycle

- Date: 2026-09-12
- Base: `cf710c7e7ef88ee03868ae48530ccd12511349f4`
- Final commit: `47580a2`
- Scope: `app/api/connections/tiktok/{start,callback,route,creator-info}`,
  `app/api/connections/status`, `lib/tiktok.ts` token/creator-info helpers,
  `lib/http.ts` `resolveOrigin`, `lib/tiktok-oauth-pure.ts`.
- Findings: creator-info now fails closed (409 reconnect) when a TikTok
  refresh succeeds but `platform_tokens` persist fails — matching cron.
  CSRF/PKCE, session binding, disconnect, and status already matched
  `openspec/changes/connect-tiktok`.
- Accepted risks: `resolveOrigin` trusts `Host`/`X-Forwarded-Proto` (TikTok
  portal still binds exact redirect URIs). Disconnect is local-only (no
  TikTok revoke). Concurrent creator-info + cron refresh can race on TikTok's
  rotating refresh (same as cron; lock would need a DB change). Refresh on
  any generic creator-info error is a conservative retry.
- Follow-up: scheduler UI swallows 409/502 on creator-info (Scheduler).
- Verification: `npm run test:tiktok-oauth` (red on persist-proceed, then
  green), `npm run test:tiktok-creator-info`,
  `npm run test:tiktok-photo-proxy`, `npm run test:post-ownership`,
  `npm run test:auth`, `npm run lint` (0 errors; 11 pre-existing warnings),
  `npm run build`, and `git diff --check` passed.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Integrations: TikTok publish client

- Date: 2026-09-12
- Base: `d7d744c9b8d2912ff266a5eaac3d8cb56c692aae`
- Final commit: `f3d1018`
- Scope: `lib/tiktok.ts` publish helpers (`publishToTikTok`,
  `publishPhotoToTikTok`, `waitForTikTokPublishOutcome`, disclosure guard,
  photo conversion/proxy), `lib/tiktok-publish-pure.ts`. Cron claim lock
  stays Scheduler.
- Findings: publish errors no longer embed signed URL query tokens (cron
  copies them onto `posts.last_error`). Branded-content + SELF_ONLY reject,
  status poll outcomes, and photo PULL_FROM_URL already matched shipped
  specs.
- Accepted risks: publish helpers do not re-assert path ownership (cron
  does). Unauthenticated photo proxy remains a Storage-accepted constraint.
  Optimistic-Init JSDoc is stale relative to cron polling.
- Follow-up: cron `isTikTokPermanentFailure` regex does not match the
  current photo-path error text (Scheduler). Converted `.tiktok.jpg`
  siblings are not swept. YouTube fetch errors still embed signed URLs.
- Verification: `npm run test:tiktok-publish` (red on token-in-error, then
  green), `npm run test:tiktok-oauth`, `npm run test:tiktok-creator-info`,
  `npm run test:tiktok-photo-proxy`, `npm run test:post-ownership`,
  `npm run test:storage-sign-ownership`, `npm run lint` (0 errors; 11
  pre-existing warnings), `npm run build`, and `git diff --check` passed.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Integrations: YouTube OAuth and token lifecycle

- Date: 2026-09-12
- Base: `9ae2440d05f5d1ae496f4f198c3ec8a54db92a74`
- Final commit: `5ef7cc7`
- Scope: `app/api/connections/youtube/{start,callback,route}`,
  `app/api/connections/status` (YouTube bit), `lib/youtube-oauth-pure.ts`.
- Findings: reconnect now preserves a stored `refresh_token` when Google
  omits one, and fails closed if the existing-row lookup errors. CSRF,
  session binding, and disconnect already matched Model B.
- Accepted risks: disconnect is local-only (no Google revoke). Concurrent
  reconnects can race on read-then-upsert (Google refresh is stable).
  YouTube still uses `request.url` origin, not `resolveOrigin`. Code
  exchange still happens before session check (TikTok binds first).
- Follow-up: legacy `app/calendar/page.tsx` treats login as "YouTube
  Connected" (Public/deployment or Scheduler).
- Verification: `npm run test:youtube-oauth` (red on refresh wipe, then
  green), `npm run test:tiktok-oauth`, `npm run test:auth`,
  `npm run test:post-ownership`, `npm run lint` (0 errors; 11 pre-existing
  warnings), `npm run build`, and `git diff --check` passed.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Integrations: YouTube upload client

- Date: 2026-09-12
- Base: `be40b0df0b63ab659bc04e662c0e3927a9159b7d`
- Final commit: `bbf006a`
- Scope: `lib/youtube.ts` `uploadToYouTube`, `lib/youtube-publish-pure.ts`.
  Cron claim lock stays Scheduler.
- Findings: storage-fetch errors now redact signed URL tokens (shared
  `redactPublishMediaRef`). Removed the access-token prefix log. In-memory
  refresh and public privacy default were already correct.
- Accepted risks: helper does not re-assert path ownership (cron does).
  Hosted http `video_url` remains a cron-owned flow.
- Follow-up: cron still logs OAuth token previews (Scheduler / Admin log
  redaction). Google API error dumps in cron catch.
- Verification: `npm run test:youtube-publish` (red on token-in-error, then
  green), `npm run test:youtube-oauth`, `npm run test:tiktok-publish`,
  `npm run test:post-ownership`, `npm run lint` (0 errors; 11 pre-existing
  warnings), `npm run build`, and `git diff --check` passed.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Integrations: Instagram OAuth and token lifecycle

- Date: 2026-09-12
- Base: `8ae3400ab00bef798b212e82db2c441c4727fa4c`
- Final commit: `5f7b672`
- Scope: `app/api/connections/instagram/{start,callback,route}`,
  `lib/instagram.ts` token exchange, `lib/instagram-oauth-pure.ts`.
- Findings: token-exchange errors no longer JSON-dump Meta payloads
  (access_token leak). CSRF, eligibility-before-persist, and
  `platform_user_id` already matched the spec.
- Accepted risks: Phase 3 proactive long-lived refresh is still
  unimplemented (60-day expiry). Disconnect is local-only. State cookie
  is not bound to user id (same as TikTok/YouTube).
- Follow-up: none remaining for Instagram OAuth.
- Verification: `npm run test:instagram-oauth` (red on token-in-error,
  then green), `npm run test:youtube-oauth`, `npm run test:tiktok-oauth`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`,
  and `git diff --check` passed.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Integrations: Instagram publish client

- Date: 2026-09-12
- Base: `7418c25e61e1582650b43af6a030a9facb4464a2`
- Final commit: `703a64a`
- Scope: `lib/instagram.ts` publish helpers (`createMediaContainer`,
  `getContainerStatus`, `publishContainer`,
  `ensureInstagramCompatibleImage`), `lib/instagram-publish-pure.ts`.
  Cron claim lock stays Scheduler.
- Findings: Graph errors now use `error.message` with signed URL tokens
  stripped; non-JSON bodies fail closed as `unknown`; storage-check
  paths are redacted. JPEG conversion and permanent-failure classifier
  already matched the spec.
- Accepted risks: helpers do not re-assert path ownership (cron does).
  JPEG upload SDK messages stay unredacted (TikTok parity). Phase 3
  token refresh remains unimplemented.
- Follow-up: cron token-preview logs and claim/idempotency stay
  Scheduler.
- Verification: `npm run test:instagram-publish` (red on raw Graph
  body, then on echoed token, then green), `npm run test:instagram-oauth`,
  `npm run test:tiktok-publish`, `npm run test:post-ownership`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`,
  and `git diff --check` passed.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Scheduler: Cross-tool handoff and dashboard reads

- Date: 2026-09-12
- Base: `7818f07e7c6ceb36bec25d3fe49161b9ae46badf`
- Final commit: unchanged (review-only)
- Scope: `lib/scheduler-handoff.ts`, `GenerationScheduleButton.tsx`,
  `StatsRow.tsx`, scheduler deep-link intake.
- Findings: none. Handoff only builds URL params; `POST /api/posts` re-asserts
  path ownership. StatsRow is a profile-scoped GET.
- Accepted risks: `caption` query length is uncapped (cosmetic). Deep-link
  `assetUrl` can be a raw path in the address bar.
- Follow-up: legacy `/calendar` YouTube-connected-on-login remains.
- Verification: review-only; `npm run test:post-ownership` and
  `npm run test:storage-sign-ownership` already green on `7818f07`.
- Security: 0 critical, 0 high, 0 unaccepted medium.

### Scheduler: In-app calendar UI

- Date: 2026-09-12
- Base: `1d00e75f875d1b953db5a9442b985c2fea926db5`
- Final commit: unchanged (review-only)
- Scope: `CalendarPageClient.tsx`, `calendar/page.tsx`, `lib/post-status.ts`.
- Findings: none requiring a code change. Edit/cancel/drag use owner-scoped
  PATCH; `canEdit` locks published and active claims; server 409 is toasted.
- Accepted risks: no dedicated Retry button (failed posts re-arm via edit or
  drag). After 409 the modal is not auto-refreshed.
- Follow-up: cross-tool handoff and legacy `/calendar` remain.
- Verification: review-only; neighboring `npm run test:post-ownership` already
  green on `1d00e75`.
- Security: 0 critical, 0 high, 0 unaccepted medium (docs-only checkpoint).

### Scheduler: Composer UI TikTok preflight

- Date: 2026-09-12
- Base: `10d06065e828d63c478931e1d2cd90a86b41ae63`
- Final commit: `c18912c`
- Scope: `SchedulerPageClient.tsx`, `lib/tiktok-creator-info-pure.ts` HTTP
  outcome helpers.
- Findings: creator-info 409/502 no longer look like "Loading…"; reconnect and
  outage block schedule and show an alert. Client `platformResults` retry
  idempotency was already correct.
- Accepted risks: `httpKind === "loading"` does not block schedule if a prior
  privacy level is already set (same-user only; cron still publishes).
- Follow-up: in-app calendar UI, handoff, and legacy `/calendar` remain.
  Browser E2E of the 409/502 banners was not run (no live TikTok 409).
- Verification: `npm run test:tiktok-creator-info` (red on 409-as-loading,
  then green), `npm run test:tiktok-oauth`, `npm run test:post-ownership`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`, and
  `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Scheduler: Failed-post storage cleanup cron

- Date: 2026-09-12
- Base: `90a5bd853cd2a75fb3dfb40148aff05688f39487`
- Final commit: `d437a2b`
- Scope: `GET /api/cron/cleanup-failed-posts`, `lib/post-storage-cleanup.ts`,
  `lib/post-storage-cleanup-pure.ts`.
- Findings: cleanup now claims with `status IN (failed, published)` before
  deleting objects, so a PATCH re-arm to `scheduled` skips reclaim. Unparseable
  `video_url` warnings redact signed-URL tokens.
- Accepted risks: `CRON_SECRET` open when unset. Narrow claim-then-PATCH
  window can still delete after the claim UPDATE wins. A stale batch can
  clean a post that retried and failed again with a fresh `failed_at`.
  Asset-linked videos skip object delete; only `/uploads/scheduler/` photos
  are removed. `minDays=0` is an explicit override.
- Follow-up: `docs/ops/cron-jobs.md` still omits this sixth cron. Scheduler
  and calendar UI remain.
- Verification: `npm run test:post-cleanup` (red on re-arm reclaim, then
  green), `npm run test:cron-publish`, `npm run test:post-ownership`,
  `npm run test:tiktok-publish`, `npm run lint` (0 errors; 11 pre-existing
  warnings), `npm run build`, and `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Scheduler: Publisher cron claim, retries, and logs

- Date: 2026-09-12
- Base: `c16c540acab6f3d0a1586e76e1a42c6851bc83e3`
- Final commit: `1425fac`
- Scope: `GET /api/cron`, `lib/cron-publish-pure.ts`. Claim lock and platform
  IDs were already correct; classifiers and log redaction were not.
- Findings: TikTok photo-path errors now fail permanently (live text is
  "not a recognized user photo storage path"). Token previews removed;
  processing logs redact signed `video_url` tokens; Google catch logs status
  only.
- Accepted risks: `CRON_SECRET` open when unset (documented). YouTube
  upload-then-persist can duplicate if the function dies after upload
  (`scheduler-cron-reliability` residual; `maxDuration=60`). TikTok
  refresh-then-persist is required by token rotation. Success UPDATE is
  `.eq("id")` only; a live worker cannot outlive the 10-minute stale window
  under the current 60s cap. Claim lock + `MAX_POSTS_PER_RUN=1` unchanged.
- Follow-up: Instagram missing-video is still transient in
  `isInstagramPermanentFailure` (cleanup/cron adjacent). Stack traces and
  share-URL `console.warn(err)` stay Admin log redaction. Failed-post
  storage cleanup and scheduler/calendar UI remain.
- Verification: `npm run test:cron-publish` (red on photo-path and signed
  URL log, then green), `npm run test:post-ownership`,
  `npm run test:tiktok-publish`, `npm run test:instagram-publish`,
  `npm run test:youtube-publish`, `npm run test:tiktok-creator-info`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`, and
  `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Scheduler: Posts API create, list, and mutate

- Date: 2026-09-12
- Base: `51af53fdc5f817bb19ec27bf3209b7e59e741f6a`
- Final commit: `4f75201`
- Scope: `POST|GET /api/posts`, `PATCH /api/posts/[id]`, `lib/post-ownership-pure.ts`.
- Findings: unauthenticated hosted-URL schedule now 401; PATCH UPDATE is claim-safe
  (not published + null/stale `publish_started_at`) and lost race is 409.
- Accepted risks: wrong-owner PATCH stays 403 after fetch-by-id. Authenticated
  hosted `http` `video_url` remains a cron fetch flow. Live `posts_status_check`
  already allows `canceled` (088).
- Follow-up: after the 10-minute stale window, PATCH can cancel while a cron
  worker may still be uploading — cron success updates do not re-check status
  (Publisher cron). `isTikTokPermanentFailure` regex, token-preview logs, and
  claim/idempotency stay Publisher cron.
- Verification: `npm run test:post-ownership` (red on hosted-URL 401 and claim
  race, then green), `npm run test:storage-sign-ownership`, `npm run test:auth`,
  `npm run test:tiktok-publish`, `npm run test:youtube-publish`,
  `npm run test:instagram-publish`, `npm run test:creation-ownership`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`, and
  `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

## Deferred

None.

## Audit log template

Append one entry per completed slice:

```markdown
### <domain: slice>

- Date: <YYYY-MM-DD>
- Base: `<sha>`
- Final commit: `<sha or unchanged>`
- Scope: <paths and trust boundary>
- Findings: <confirmed fixes, or none>
- Accepted risks: <issue path or none>
- Verification: <commands and result>
- Security: <result>
```
