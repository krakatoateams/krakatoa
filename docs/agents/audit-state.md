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

- Domain: Public/deployment
- Slice: Client bundle versus server-secret boundary (delivery)
- Status: `blocked`
- Blocker: [PR #192](https://github.com/krakatoateams/krakatoa/pull/192)
  is clean and its quality gate passed, but GitHub reports a partial system
  outage and both GraphQL and REST merge endpoints return HTTP 502.
- Safest next command: `gh pr merge 192 --merge --delete-branch`

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
- [x] Scheduler: posts, retries, concurrent publication, and cron protection
  - [x] Posts API: create, list, and mutate
  - [x] Publisher cron: claim, idempotency, retries, concurrent runs
  - [x] Failed-post storage cleanup cron
  - [x] Scheduler composer UI: schedule, bulk retry, TikTok preflight
  - [x] In-app calendar UI: edit, cancel, drag-reschedule
  - [x] Cross-tool handoff and dashboard reads
  - [x] Legacy public calendar (`/calendar`)
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
- [x] Admin: configuration, monitoring, prompt exposure, and log redaction
  - [x] Monitoring: cross-user job reads and detail disclosure
  - [x] Monitoring: anomaly classification
  - [x] Prompt capture: primary generation routes
  - [x] Prompt capture: secondary / unmetered routes
  - [x] Log redaction: publisher cron residuals
  - [x] Admin analytics: RPC aggregates and paginated user PII
  - [x] Admin metrics: cross-user dashboard reads
  - [x] Admin Config v2: PATCH validators and reset safety
  - [x] Admin Config v2: feature-model and catalog toggles
  - [x] Admin Config v2: tree builder and UI read contract
  - [x] Admin Config v2: persistence layer
  - [x] Platform settings: expiry, welcome knobs, credit packs
    - [x] Credit packs and welcome controls
    - [x] Expiry settings and manual enforcement
  - [x] Admin skills catalog
  - [x] Log redaction: admin API and ops crons
  - [x] Log redaction: generation route error logging
    - [x] Primary generation and shared pipelines
    - [x] Secondary generation and admin test route
  - [x] Admin dev-blank generation
- [ ] Public/deployment: auth UI, redirects, headers, dependencies, and secrets
  - [x] Dependency and Image Optimizer supply chain
  - [x] Production secrets and fail-open deployment guards
  - [x] Deployment CI quality-gate automation
  - [x] Site-wide security headers and CSP
  - [x] Logged-out middleware route matrix and draft hand-off
  - [x] Auth modal forms and password lifecycle
  - [x] Standalone auth pages and redirect chain
  - [x] Public unauthenticated read APIs
  - [x] Marketing landing and legal pages
  - [x] Client bundle versus server-secret boundary
  - [ ] PWA install surface
  - [ ] Internal and dev-only route obscurity
  - [ ] Supabase Auth leaked-password protection

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

### Scheduler: Legacy public calendar (`/calendar`)

- Date: 2026-09-12
- Base: `5f9d7bbfa734177e0c4ff2395a087dbd330af866`
- Final commit: `e748c97`
- Scope: `app/calendar/page.tsx`, `lib/legacy-calendar-badge-pure.ts`.
- Findings: the YouTube badge now requires a `platform_tokens` YouTube row via
  `/api/connections/status`. Signed-in users without YouTube get Connect
  YouTube (`/api/connections/youtube/start`); signed-out users get Sign in.
- Accepted risks: brief "Connect YouTube" flash while status loads (fail-closed).
  `/calendar` remains an orphaned duplicate of the in-app calendar.
- Follow-up: consider redirecting `/calendar` → `/tools/scheduler/calendar`
  (Public/deployment). Admin and Public/deployment queues remain.
- Verification: `npm run test:legacy-calendar-badge` (red on login-as-connected,
  then green), `npm run test:youtube-oauth`, `npm run test:post-ownership`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`, and
  `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

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

### Admin: monitoring cross-user job reads and detail disclosure

- Date: 2026-09-13
- Base: `72b9893d0a64bde6e12d8700d199380578b80503`
- Final commit: unchanged (review-only)
- Scope: `lib/admin-monitoring-db.ts`, `GET /api/admin/monitoring`,
  `GET /api/admin/monitoring/[jobId]`, `app/(app)/admin/monitoring/page.tsx`,
  `scripts/probe-monitoring.ts`. Admin-only cross-user list/detail; prompts
  detail-only; no signed-URL minting.
- Findings: none requiring a code change. Both routes use `withAdmin()`;
  list `MonitoringRow` omits `jobs.input`/`output`; detail `PromptSection`
  reads only persisted fields; assets show `storage_path` only. Absent
  `limit` no longer becomes `.limit(0)`.
- Accepted risks: list JSON still includes full `jobs.error` and
  `currentStep.error` (UI shows `errorCode`; possible prompt fragments in
  provider messages). Detail returns ledger `metadata` and recovery
  `replicateVideoUrl` beyond the table UI. `STEP_ROW_CAP=4000` can silently
  truncate busy windows (same class as the documented 200-row list cap).
  Live poll has no abort; stale overwrite is UX-only on a read-only panel.
- Follow-up: `PromptSection` empty copy still says routes "never persist"
  (stale vs post-11 Aug capture) — Prompt capture slice. Anomaly
  classification stays the next Admin slice.
- Verification: `npm run test:monitoring-flags`,
  `npm run admin:probe-monitoring` (live 50-row/720h probe ok),
  `npm run test:admin-auth`, `npm run lint` (0 errors; 11 pre-existing
  warnings), `npm run build`, and `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Admin: monitoring anomaly classification

- Date: 2026-09-13
- Base: `b5e98522126e0a4cf93a1f52a8461323dd6af738`
- Final commit: unchanged (review-only)
- Scope: `lib/admin-monitoring-flags.ts` plus delegation into
  `shouldRefundRecoverableTerminal()` and `isRefundEligible()`.
- Findings: none requiring a code change. `stuck` / `cancel_not_honored` /
  `refund_missing` match the spec; recoverable refund rules are delegated,
  not restated. Live terminal error codes are mapped or correctly fall
  through as intended positives.
- Accepted risks: `cancelRequestedAtMs` uses `generation_requests.updated_at`
  (no `cancel_requested_at` column). Unmapped new terminal codes flag
  `refund_missing` until added to `RECOVERABLE_TERMINAL_CODES`. Doc §stuck
  still cites only `updated_at` (code also uses workflow heartbeat).
- Follow-up: Prompt capture is the next Admin slice.
- Verification: `npm run test:monitoring-flags`,
  `npm run test:recoverable-refund`, `npm run lint` (0 errors; 11
  pre-existing warnings), `npm run build`, and `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Admin: prompt capture on primary generation routes

- Date: 2026-09-13
- Base: `04c4b6601ff00bd662ec6610f69b8e551d15a749`
- Final commit: `7f201d7`
- Scope: `lib/admin-prompt-capture-pure.ts`, Reels Seedance/Veo pipelines,
  `generate-video`, `generate-photo`, `generate-motion-control`,
  `generate-storyboard-video`, `lib/photo-storyboard-generation.ts`,
  monitoring `PromptSection` empty copy.
- Findings: Reels `scene_breakdown` now stores scene prompts + narration
  (not a count). Assembled model prompts persist on the generating step
  for video, photo, motion-control, storyboard image, storyboard video,
  and Veo single. Storyboard-video jobs store `theme` only. Empty copy
  no longer claims every route never persists.
- Accepted risks: storyboard-image `scene_breakdown` still stores a
  scene count (Reels-only spec). Veo `veo_prompt` step still stores
  `promptChars`; the assembled string is on `video_generation`. System
  instructions remain unstored.
- Follow-up: Prompt capture on secondary/unmetered routes is next.
- Verification: `npm run test:prompt-capture` (red on scene count, then
  green), `npm run test:monitoring-flags`, `npm run test:video-studio`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`,
  and `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Admin: prompt capture on secondary / unmetered routes

- Date: 2026-09-13
- Base: `9278f1778624f71c9b1d6a944e0a7143edd0f231`
- Final commit: unchanged (review-only)
- Scope: `app/api/generate-canvas-text/route.ts`,
  `app/api/render-editor/route.ts`, `app/api/generate-caption/route.ts`.
- Findings: none requiring a code change. Canvas already stores the user
  instruction on the job and the assembled Gemini prompt on `canvas_text`;
  system instruction stays provider-only. Editor uses a static
  `Editor export` label (no user generation prompt). Caption has no job
  and is excluded from the monitoring prompt surface.
- Accepted risks: caption remains unmetered and invisible to monitoring.
- Follow-up: Log redaction (publisher cron residuals) is next.
- Verification: `npm run test:canvas`, `npm run test:editor`,
  `npm run test:prompt-capture`, `npm run lint` (0 errors; 11 pre-existing
  warnings), and `git diff --check` passed. Product code unchanged from
  `9278f17`, which already passed `npm run build`.
- Security: review of the three routes found 0 critical, 0 high, and 0
  unaccepted medium findings.

### Admin: log redaction on publisher cron residuals

- Date: 2026-09-13
- Base: `587f00e1ac00bdf70e601eebbebc07fbaac213fe`
- Final commit: `198ed2aa99ed34aa6a04551108d8955c8d306100`
- Scope: `app/api/cron/route.ts` share-URL catch and outer-catch logs;
  `lib/cron-publish-pure.ts` `cronErrorLogSafe`. Instagram missing-video
  classifier stayed out of slice.
- Findings: share-URL `console.warn(..., err)` dumped the full Error
  (stack included); the outer catch printed `Error.stack`. Both now log
  `cronErrorLogSafe` (message only, `http(s)` query tokens stripped).
  Share-URL failure still publishes; `last_error` persist unchanged.
- Accepted risks: scheme-less `path?token=` in a future throw is not
  rewritten here (publish clients already call `redactPublishMediaRef`).
  No generic Bearer/OAuth substring scrubber; current throw sites do not
  embed tokens. Other cron `console.*` lines stay message-only status
  text. `posts.last_error` still stores the classified message.
- Follow-up: Admin analytics RPC aggregates and paginated user PII.
  Remaining log-redaction slices cover admin API / ops crons and
  generation route error logging.
- Verification: `npm run test:cron-publish` (red on stack leak, then
  green), `npm run test:post-ownership`, `npm run test:tiktok-publish`,
  `npm run test:instagram-publish`, `npm run test:youtube-publish`,
  `npm run test:tiktok-creator-info`, `npm run test:admin-auth`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`,
  and `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted
  medium findings.

### Admin: analytics RPC aggregates and paginated user PII

- Date: 2026-09-13
- Base: `c00620a7a037c9a44b0bb7b9bd8a30326a0a76ff`
- Final commit: `ee6cde7081639ae8463df9ad978aed10cdb656e6`
- Scope: `GET /api/admin/analytics`, `/daily`, `/users`;
  `lib/admin-analytics-db.ts`; `lib/admin-page-params.ts`;
  `AdminAnalytics.tsx`; migrations `060`/`061`; live `krakatoa_admin_*`
  EXECUTE grants; country capture in `lib/profiles-db.ts`.
- Findings: no authorization or PII-leak defect. All three routes use
  `withAdmin()`. Users are PostgREST-ranged and `limit` is capped at 100.
  File header overstated daily "server-side" pagination; comment now
  matches the fetch-all-then-slice used because headlines already need
  the full UTC-day series. No query/grant/route behavior change.
- Accepted risks: an active admin can enumerate every email/balance by
  paging (`offset` uncapped). Daily RPC is re-fetched per page (one row
  per UTC day). `060`/`061` names are absent from the live migration
  ledger; the five functions exist, INVOKER, service_role-only (092).
  Country capture trusts Vercel's 2-letter geo header. Duplicate Sales
  + DAU daily fetches are UI waste, not a leak.
- Follow-up: Admin metrics cross-user dashboard reads.
- Verification: live SQL `anon_exec=false` / `service_role_exec=true` on
  all five `krakatoa_admin_*` functions; `profiles.country` present.
  `npm run test:rpc-grants`, `npm run test:admin-auth`, `npm run lint`
  (0 errors; 11 pre-existing warnings), and `git diff --check` passed.
  Product behavior unchanged from `c00620a`, which already passed
  `npm run build`.
- Security: final review found 0 critical, 0 high, and 0 unaccepted
  medium findings.

### Admin: metrics cross-user dashboard reads

- Date: 2026-09-13
- Base: `c39696847275b08e4ce0c639fc3286f994276e60`
- Final commit: `094349bc4293addbe25157ab6eeda486c316abeb`
- Scope: `lib/admin-metrics-db.ts`, `lib/admin-metrics-pure.ts`,
  `GET /api/admin/{summary,usage,jobs,credits,credits/wallets}`,
  `app/(app)/admin/page.tsx`, `usage/page.tsx`.
- Findings: `?limit=-1`/`0` on jobs/credits reached `.limit()` unclamped.
  `clampAdminListLimit` now defaults 50 / max 200. Overview and usage
  ignored `capped` flags while status/tool chips summed only the newest
  5000 jobs; amber banner now uses `adminMetricsCapNotice`. Wallet/ledger
  `capped` uses exact `countRows > 5000` (not `length >= 5000`).
- Accepted risks: JS `ROW_CAP=5000` aggregation remains Phase 1 (SQL
  deferred). Wallet subset above 5000 is unordered. Jobs/credits lists
  have no offset (admin sees at most 200 emails). Usage page still does
  not check `res.ok` (layout + `withAdmin` backstop). Browser E2E of the
  banner was not run (admin session required).
- Follow-up: Admin Config v2 PATCH validators and reset safety.
- Verification: `npm run test:admin-metrics` (red on leaky clamp, then
  green), `npm run test:admin-auth`, `npm run test:rpc-grants`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`,
  and `git diff --check` passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted
  medium findings.

### Admin: Config v2 PATCH validators and reset safety

- Date: 2026-09-13
- Base: `2a12e3cd5d9721c3112981d5f60b7159efe063ca`
- Final commit: `066bbadff4fd4ab5549d807ba728ed80d6a1d87e`
- Scope: `lib/admin-config-validation.ts`; pricing/model/tool PATCH and
  `/reset`. Feature-model and catalog stayed out of slice.
- Findings: all six routes already used `withAdmin()` and the shared
  validator. `containsSecretKey` was top-level only — nested
  `parameters.opts.api_key` would persist. Walk is now recursive
  (objects/arrays) and applies to metadata too. Reset still validates
  defaults before update (no delete/reinsert).
- Accepted risks: `credit_amount: 0` still allowed with a warning.
  Value-only secrets under benign keys are not scanned. Reset does not
  clear existing metadata. Partial PATCH does not re-scan stored JSON.
- Follow-up: Admin Config v2 feature-model and catalog toggles.
- Verification: `npm run test:admin-config-validation` (red on nested
  key, then green), `npm run test:admin-auth`,
  `npm run test:admin-metrics`, `npm run lint` (0 errors; 11
  pre-existing warnings), `npm run build`, and `git diff --check`
  passed.
- Security: final review found 0 critical, 0 high, and 0 unaccepted
  medium findings.

### Admin: Config v2 feature-model and catalog toggles

- Date: 2026-09-13
- Base: `27efb4e625d037e1fda2a9dd981e7edc6720775c`
- Final commit: `f156fe6`
- Scope: feature-model and catalog admin APIs/DB readers, Video Studio
  enablement helpers, `/api/generate-video`, motion-control and storyboard
  generation gates, and every `/api/generate-video` client.
- Findings: an explicitly empty composer no longer fell back to the full
  catalog. Motion-control, storyboard, Viral template, Text to video, Image to
  video, Canvas, and Skill requests now carry or resolve a composer and reject
  admin-disabled models before spend/provider work. The composer discriminator
  is included in idempotency hashes and job/usage metadata.
- Accepted risks: Text to video intentionally supports optional first-frame and
  reference inputs, so the shared route cannot classify every reference-bearing
  request as Image to video; the validated client discriminator defines the
  product flow. Default changes remain clear-then-set rather than transactional,
  and reset cache invalidation is latent while the resolver TTL is `0`.
- Verification: `npm run test:admin-config-toggles` (red then green),
  `npm run test:video-studio`, `npm run test:canvas`, `npm run test:skills`,
  `npm run test:studio-submit`, `npm run test:admin-auth`,
  `npm run test:admin-config-validation`, `npm run lint` (0 errors; 11
  pre-existing warnings), `npm run build`, `git diff --check`, and edited-file
  diagnostics passed.
- Security: final review found 0 critical, 0 high, 0 medium, and one accepted
  low finding for the intentional shared-route reference overlap.

### Admin: Config v2 tree builder and UI read contract

- Date: 2026-09-13
- Base: `4ee07bb89875d2933357221fec4f0ec91b8821f4`
- Final commit: `ce55174`
- Scope: `lib/admin-config-tree.ts`, the Config v2 parallel GET/load contract,
  tool/model/mode/variant/pipeline construction, legacy cutover/navigation,
  and a new focused tree self-check.
- Findings: the fixed tree allowlist omitted Dashboard and IG and ignored
  persisted tool ordering; all `tool_configs` rows now render in `sort_order`.
  Tool, pricing, feature-model, catalog, and model-config responses now fail
  closed on HTTP or payload-shape errors instead of silently building a partial
  tree. Failed refreshes clear stale editable data, and refresh refuses to
  overwrite pending autosaves. Tests pin pricing fallback, pipeline placement,
  duplicate-default normalization, and complete tool coverage.
- Accepted risks: typed admin APIs remain the source of field types, so client
  coercion could mis-render a hypothetical string boolean. Billing-settings
  reads still fall back to code defaults because they affect Suggest only, not
  runtime billing. OpenSpec still describes batch mode saves while the shipped
  panel autosaves each row.
- Verification: `npm run test:admin-config-tree` (red then green),
  `npm run test:admin-config-toggles`, `npm run test:admin-auth`,
  `npm run test:admin-config-validation`, `npm run lint` (0 errors; 11
  pre-existing warnings), `npm run build`, `git diff --check`, and edited-file
  diagnostics passed.
- Security: final review found 0 critical, 0 high, and 0 medium findings; two
  low observations were accepted as the typed-admin-API and Suggest-only
  fallback contracts above.

### Admin: Config v2 persistence layer

- Date: 2026-09-13
- Base: `547cfd8ec38a01f2ef4f9ff3bb9b2d174f1874e7`
- Final commit: `30699a9`
- Scope: pricing/model reset defaults, Config v2 pricing saves, canonical
  missing-row materialization, update/insert race handling, and Scheduler LLM
  seed alignment.
- Findings: code-only pricing variants rendered by the tree returned 404 on
  save; reset maps omitted registry pricing/model roles; Scheduler reset/seed
  disagreed with its GPT-5 runtime fallback. Missing canonical rows now
  materialize with complete v2/deprecation fields, duplicate insert races retry
  the update, registry-backed defaults are isolated from lightweight client
  imports, and Scheduler defaults align on `openai/gpt-5`.
- Accepted risks: concurrent admin writes remain last-write-wins. Direct reset
  of a missing row derives a display label from its key because Config v2 has no
  reset UI. Reset does not repair a manually corrupted `is_deprecated` flag on
  an existing row, and updates preserve existing noncanonical rows; both require
  service-role/manual preconditions and do not create a non-admin billing path.
- Verification: `npm run test:admin-config-persistence` (red then green),
  `test:admin-config-validation`, `test:admin-config-tree`,
  `test:admin-config-toggles`, `test:admin-auth`,
  `test:migration-catalog`, `npm run lint` (0 errors; 11 pre-existing warnings),
  `npm run build`, `git diff --check`, and edited-file diagnostics passed.
  Supabase MCP recorded `schedule_gpt5_model_config` and verified the live
  Scheduler row as `openai/gpt-5`.
- Security: final review found 0 critical, 0 high, and 0 medium findings; two
  low admin-trust/manual-corruption hardening notes are accepted above.

### Admin: credit packs and welcome controls

- Date: 2026-09-13
- Base: `fbf1dfc3dd7a420912402cb17462af983a851bc3`
- Final commit: `456da38`
- Scope: admin pack replacement, public pack display, checkout resolution,
  welcome-bonus settings/eligibility, and migration
  `096_atomic_credit_pack_replace.sql`.
- Findings: disabling every pack still exposed and sold static defaults; pack
  replacement deleted before a separate upsert; malformed/failed pack responses
  left stale buy options; zero-credit offers appeared claimable; welcome amounts
  were unbounded; and pre-089 auto-grant recipients could claim again. Pack
  display and checkout now fail closed, full-set saves are transactional,
  welcome values are bounded on write/read, and both legacy/current grant keys
  fence eligibility.
- Accepted risks: welcome eligibility versus first-job creation remains a
  non-atomic TOCTOU; idempotency prevents duplicate grants, and a durable fix
  requires an atomic claim RPC. Clients may briefly render seed packs before the
  first fetch, but checkout always re-resolves the live active row. Pack numeric
  maxima beyond Postgres constraints remain an admin-trust policy choice.
- Verification: `npm run test:admin-platform-settings` (red then green),
  `test:doku-fulfillment`, `test:admin-auth`, `test:rpc-grants`,
  `test:migration-catalog`, `npm run lint` (0 errors; 11 pre-existing warnings),
  `npm run build`, `git diff --check`, and edited-file diagnostics passed.
  Supabase MCP applied `atomic_credit_pack_replace`; the RPC is invoker-security,
  has an empty search path, and is executable only by `service_role`. Live pack
  state remained 4 total / 4 active.
- Security: final review found 0 critical, 0 high, and 0 unaccepted medium
  findings; the accepted low TOCTOU is recorded above.

### Admin: expiry settings and manual enforcement

- Date: 2026-09-13
- Base: `4b16235370d07df0eb7d7c51f804f1a7abdc25a2`
- Final commit: `345964d`
- Scope: expiry settings reads, manual admin preview/live actions, creation
  expiry batching, daily creation-expiry cron progress, and dependent
  asset/storage cleanup order.
- Findings: creation expiry stopped at the PostgREST row cap, removed storage
  before durable rows, offered one-click permanent deletion, could ignore
  unsaved settings, and let photo backlogs starve video processing. Dry-run now
  uses exact counts; live work drains bounded batches, deletes library rows
  first, reports remaining work, and gives each cron target a budget. Manual
  live runs reuse a non-future preview timestamp, bind fresh retention settings,
  reject policy drift, and require explicit confirmation.
- Accepted risks: direct authenticated-admin API calls may intentionally omit a
  preview checkpoint. Asset/storage cleanup remains best-effort after row
  deletion, so failed cleanup can leave an orphan but not a visible broken
  library row. Large backlogs drain incrementally (400 rows per media target per
  cron invocation); `CRON_SECRET` remains mandatory in production.
- Verification: `npm run test:creation-expiry` (red then green),
  `test:storage-sweep`, `test:storage-sign-ownership`, `test:admin-auth`,
  `npm run lint` (0 errors; 11 pre-existing warnings), `npm run build`,
  `git diff --check`, and edited-file diagnostics passed.
- Security: final review found 0 critical, 0 high, and 0 medium findings; the
  direct-admin and best-effort-cleanup risks are accepted above.

### Admin: skills catalog

- Date: 2026-09-13
- Base: `694fa082e89eea8d4ad22c6f65d7f1f3a6bf67be`
- Final commit: `74bb280`
- Scope: global master-skill CRUD/overlays, owner separation, photo/video
  composer contracts, server-side model pins, input-slot validation, and
  thumbnail replacement/revert/delete lifecycle.
- Findings: required character-only photo inputs always failed outside product
  mode; null overlays erased code model pins; designated model/resolution was
  client-only; welcome-video duration could drift from its 10-credit grant;
  unsupported slot combinations produced unsendable forms; disabled/ineligible
  photo tiers caused UI dead ends; and thumbnail replacement/revert/delete left
  orphaned or broken references. Pins and input capabilities now align
  client/server before spend, welcome-video is fixed to 5s/480p while its model
  is active, invalid slot matrices are rejected, and thumbnail mutations use
  fresh rows with compensating/path-scoped cleanup.
- Accepted risks: concurrent replacement of the same thumbnail can leave one
  unreferenced object; storage cleanup is best-effort. Global config reads keep
  the documented 60s/code-catalog fail-open behavior, and public catalog
  responses expose recipe text needed by the current editor contract.
- Verification: `npm run test:admin-skills-catalog` (red then green),
  `test:skills`, `test:admin-config-toggles`, `test:studio-submit`,
  `test:admin-auth`, `test:storage-sign-ownership`, `npm run lint` (0 errors;
  11 pre-existing warnings), `npm run build`, `git diff --check`, and
  edited-file diagnostics passed.
- Security: final review found 0 critical, 0 high, and 0 medium findings; the
  accepted low cache/storage/prompt-visibility observations are recorded above.

### Admin: API and ops-cron log redaction

- Date: 2026-09-13
- Base: `953dcf78dd7a05b9bd790caa05d737ff50ead4cd`
- Final commit: `7161b66`
- Scope: shared admin 500 handling, direct admin/skill logs, admin-user linking,
  non-publisher expiry/sweep/reconcile/failed-post crons, and their best-effort
  helper warnings.
- Findings: several catch paths logged full Error objects/stacks and returned
  raw PostgREST/storage text; downstream warnings bypassed route redaction; and
  reconcile returned raw per-item errors on HTTP 200. `errorLogSafe` now emits
  one line, strips signed queries plus Bearer/Basic/JWT/keyed credentials, and
  is applied at every in-scope log/response boundary. Cron 500s are generic and
  admin skill-delete infrastructure failures reach the shared generic 500 path.
- Accepted risks: bare storage object paths and job/post identifiers remain
  visible to the CRON-secret operator. Production still depends on
  `CRON_SECRET`; publisher-cron logging remains governed by its previously
  completed `cronErrorLogSafe` slice.
- Verification: `npm run test:admin-log-redaction` (red then green),
  `test:cron-publish`, `test:creation-expiry`, `test:storage-sweep`,
  `test:admin-skills-catalog`, `test:admin-auth`, `npm run lint` (0 errors;
  11 pre-existing warnings), `npm run build`, `git diff --check`, and
  edited-file diagnostics passed.
- Security: final review found 0 critical, 0 high, and 0 medium findings; the
  accepted operator-visibility risks are recorded above.

### Admin: primary generation and shared-pipeline log redaction

- Date: 2026-09-13
- Base: `606421da24e59e6c3ffb4e986f82641247f154d8`
- Final commit: `350861f`
- Scope: Photo/Video/Reels POSTs, metered settlement and idempotency replay,
  status/active/resume owner surfaces, credit transaction serialization, Reels
  LLM/TTS/storage logs, and shared Rendi/Replicate errors.
- Findings: routes logged raw Error stacks, LLM/provider payloads, user-derived
  output, and config names; first/replayed/polled/resumed failures returned
  provider text; refund metadata exposed the same detail through the owner
  ledger feed. Generation logs now keep only error name/code/status, all owner
  error surfaces use allowlisted generic contracts, transaction metadata is
  omitted from the client feed, and Rendi/Reels sources no longer embed raw
  bodies, signed URLs, or creative output in logs/exceptions.
- Accepted risks: owner success responses still return their signed deliverable
  data. Detailed error text remains in owner-scoped jobs, steps, generation
  requests, and ledger metadata for admin monitoring; public serializers and
  logs do not expose it.
- Verification: `npm run test:generation-log-redaction` (red then green),
  `test:metered-generation`, `test:active-generations`, `test:prompt-capture`,
  `test:studio-submit`, `test:admin-log-redaction`, `npm run lint` (0 errors;
  11 pre-existing warnings), `npm run build`, `git diff --check`, and
  edited-file diagnostics passed.
- Security: final review found 0 critical, 0 high, and 0 medium findings.

### Admin: secondary generation and admin-test log redaction

- Date: 2026-09-13
- Base: `81e6f67342c698ed8acc0542fd1ae4a88085bfb9`
- Final commit: `eeb2053`
- Scope: secondary Canvas, Editor, caption, storyboard, motion-control, test
  routes; cancellation/dismissal; metered/workflow settlement; recovery storage;
  feature/model/pricing readers; and generation log-redaction self-checks.
- Findings: raw Error stacks, provider/config details, and persisted terminal
  messages could reach logs or owner HTTP surfaces. Some refund responses inferred
  success instead of checking the ledger; post-commit terminal paths could still
  request refunds; and Canvas/motion-control/photo fallbacks allowed unstable
  non-job billing keys. Logs and owner errors are now redacted/allowlisted,
  refunds honor the provider-commit lock and actual ledger result, and charged
  attempts require a persisted job with stable job-scoped spend/refund keys.
- Accepted risks: detailed errors remain in owner-scoped jobs and steps for admin
  monitoring. Feature/model/pricing read failures retain their existing
  code-default availability policy; charged routes still spend before provider
  work. Concurrent motion-control finalization remains a pre-existing race, with
  idempotent job-scoped ledger keys preventing duplicate refunds.
- Verification: `npm run test:generation-log-redaction`,
  `test:metered-generation`, `test:generation-commit`,
  `test:generation-workflows`, `test:studio-submit`,
  `test:active-generations`, `npm run lint` (0 errors; 11 pre-existing warnings),
  `npm run build`, `git diff --check`, and edited-file diagnostics passed.
- Security: final review found 0 critical, 0 high, and 0 medium findings.

### Admin: dev-blank generation

- Date: 2026-09-13
- Base: `f0c0f89e54e48942ae0f50314fc753692905087f`
- Final commit: `10c2d0a`
- Scope: admin-only blank request parsing/access, Photo and Video composer
  controls, all six server generation paths, idempotency hashes, zero-credit
  metered attempts, provider bypass, placeholder storage, and observability
  metadata.
- Findings: non-admin requests were already rejected before spend/provider work,
  but Reels, Storyboard video, and Motion Control omitted blank mode from their
  server request hash, allowing a reused admin key to replay the wrong mode.
  Several job/asset/usage records attributed bundled placeholders to a live
  provider, and a revoked/lost admin session could leave hidden blank state
  enabled in the client. Hashes now separate live and blank attempts, persisted
  provider/model metadata uses `dev_blank`, and clients clear blank state when
  admin visibility is lost.
- Accepted risks: bundled files under `public/dev/` are publicly readable test
  assets; route authorization, owner-scoped upload paths, and metered persistence
  remain server-side. Pending OAuth drafts do not preserve blank state on every
  composer, but blank mode is only selectable after an authenticated admin check.
- Verification: `npm run test:dev-blank` (red then green),
  `test:video-studio`, `test:metered-generation`, `test:generation-commit`,
  `test:generation-workflows`, `test:studio-submit`, `test:active-generations`,
  `test:skills`, `test:admin-auth`, `test:admin-config-toggles`,
  `test:generation-log-redaction`, `npm run lint` (0 errors; 11 pre-existing
  warnings), `npm run build`, `git diff --check`, and edited-file diagnostics
  passed.
- Security: final review found 0 critical, 0 high, and 0 medium findings.

### Admin: domain closeout

- Date: 2026-09-13
- Base: `7533792b590199bed1ddeb78506e255d24363eaf`
- Final commit: `944fc05`
- Scope: the complete Admin delta since
  `72b9893d0a64bde6e12d8700d199380578b80503`, final combined tests, live
  migration/config/grant checks, and residual metered-lifecycle plus owner-skill
  failure paths.
- Findings: a required job setup failure could leave its generation request
  locked until reconcile even though spend had not started. Setup failures now
  fail any created job, close the idempotency row, and rethrow for the existing
  generic owner response. Owner skill list/create/thumb logs still emitted raw
  operational errors, while skill PATCH/DELETE could return PostgREST text as a
  400; those logs now use `errorLogSafe` and unexpected persistence failures use
  generic 500 responses. A review claim that pricing materialization must use
  live billing settings was rejected against the authoritative Option A spec:
  billing settings drive Suggest only, while explicit/default Credits persist.
- Accepted risks: detailed generation errors remain in service-role tables for
  admin monitoring; best-effort failure persistence can still wait for reconcile
  if the failure write itself is unavailable. The documented welcome-claim
  TOCTOU, bounded metrics windows, incremental expiry cleanup, and admin-trust
  configuration choices remain accepted in their individual slices.
- Verification: all Admin-focused checks passed, including admin auth/metrics,
  Config validation/toggles/tree/persistence, platform settings, skills,
  monitoring/prompt/log redaction, dev-blank, migration/RPC checks, expiry,
  metered/workflow/commit and active-generation contracts. `npm run lint`
  passed with 0 errors and 11 pre-existing warnings; `npm run build`,
  `git diff --check`, and edited-file diagnostics passed. Supabase MCP verified
  both `schedule_gpt5_model_config` and `atomic_credit_pack_replace` applied,
  Scheduler on `replicate/openai/gpt-5`, four active packs, and the replacement
  RPC as SECURITY INVOKER with service-role-only EXECUTE.
- Security: final full-domain and closeout re-reviews found 0 critical, 0 high,
  and 0 unaccepted medium findings. Live advisors show only the expected
  deny-by-default RLS INFO notices and leaked-password protection WARN; the
  latter belongs to Public/deployment.

### Public/deployment: dependency and Image Optimizer supply chain

- Date: 2026-09-13
- Base: `a18a3bfa07b4ba18d926b7693769b156f3b0f176`
- Final commit: `6a96c405d2ac8732bf271e921df10ed900d61b20`
- Scope: framework and locked dependencies, Next Image Optimizer remote-source
  policy, signed-media egress, clean-install test tooling, and the Next 15 /
  React 19 async request API compatibility boundary.
- Findings: upgraded the unsupported vulnerable Next 14 stack to patched
  Next 15.5.24 / React 19; patched and correctly classified Sharp and PostCSS;
  replaced the cross-project Supabase wildcard with the configured host and
  private-bucket signed path; migrated async cookies, headers, and dynamic route
  params; pinned `tsx` and removed every `npx` network fallback from scripts.
  A new self-check pins dependency floors, runtime placement, local tooling,
  Image Optimizer scope, and the 30-day cache contract.
- Accepted risks: UI signed URLs remain bearer links valid for 30 days so stable
  optimizer caching prevents repeat Supabase egress; this is the existing
  documented confidentiality tradeoff. The PostCSS override spans the build
  tree but is pinned and passed clean install, lint, and production build.
- Verification: red/green `npm run test:dependency-security`; clean `npm ci`;
  `npm audit` reports 0 vulnerabilities; auth/admin, canvas/editor/skills,
  ownership, DOKU, TikTok proxy/publish, Instagram publish, workflow, storage,
  aspect-ratio, and Video Studio checks passed; the live signed-URL cache probe
  passed. `npm run lint` passed with 0 errors and 11 pre-existing warnings;
  `npm run build`, `git diff --check`, CLAUDE.md's under-200-line guard, and
  edited-file diagnostics passed.
- Security: final repeated reviews found 0 critical, 0 high, and 0 unaccepted
  medium findings.

### Public/deployment: production secrets and fail-open deployment guards

- Date: 2026-09-13
- Base: `9cfeaa4b4543c468cc028587f11883fa04170d70`
- Final commit: `24e81f14ed98b6e73de595134a1e107a02bfb26b`
- Scope: all six mutation-capable `GET /api/cron/*` routes, shared deployment
  detection and bearer comparison, cron operations documentation, active
  storage-hygiene OpenSpec artifacts, and adjacent webhook/setup secret guards.
- Findings: cron authorization previously failed open whenever `CRON_SECRET`
  was absent, including production and preview deployments. All cron routes now
  use one constant-time bearer guard, reject a missing deployed secret with 503
  before mutation, and retain secretless access only for local development.
  The self-check pins policy decisions and route-family integration.
- Accepted risks: supported deployments are detected through production Node or
  Vercel markers; a custom internet-facing host deliberately using development
  markers must still set `CRON_SECRET`, as the deployment documentation
  requires. There is no repository-wide CI quality-gate aggregate, so automatic
  execution of this self-check is owned by the newly queued Public/deployment CI
  slice rather than expanding this cron-auth change into a CI design.
- Verification: `npm run test:cron-auth`, cron publish, post cleanup, storage
  sweep, creation expiry, generation workflows, recoverable refund, admin
  platform settings, and DOKU fulfillment checks passed. `npm audit` reports 0
  vulnerabilities; `npm run lint` passed with 0 errors and 11 pre-existing
  warnings; `npm run build`, `git diff --check`, CLAUDE.md's under-200-line
  guard, and edited-file diagnostics passed.
- Security: final review found 0 critical, 0 high, 0 medium, and 2 documented
  low operational findings.

### Public/deployment: deployment CI quality-gate automation

- Date: 2026-09-13
- Base: `b016ca85f5267e6397e46168bfe9f4ebcaaaffd5`
- Final commit: `02f22c3cf8bbb022e52b6ba014aa54677a21ab5a`
- Scope: GitHub pull-request and `main` push automation, locked dependency
  installation, deployment/security self-checks, dependency audit, lint/build,
  committed-patch whitespace, Vercel main-only deployment policy, and publisher
  workflow token permissions.
- Findings: the only GitHub workflow mutated the production publisher and no
  automated check ran before code reached deployable `main`. Added a secretless
  quality workflow with read-only permissions, immutable current Action pins,
  no persisted checkout credentials, Node 24, `npm ci`, a shared
  `ci:checks` command, and event-scoped `git diff --check`. The deployment
  self-check pins this workflow, Node/lockfile parity, CLAUDE.md size, main-only
  Vercel deployment, no repository secrets/variables, and the publisher's empty
  token permissions. The first live run also proved the old Node 20.9 contract
  stale against locked Node 22+ dependencies, while the second exposed missing
  build-time Supabase values; the final workflow uses the Vercel-aligned Node 24
  runtime and reserved `.invalid` non-secret placeholders.
- Accepted risks: the repository currently has no `main` branch protection or
  ruleset, so the quality workflow is automatic but not a required merge status.
  The audit merge procedure remains the immediate backstop; repository-admin
  enforcement is recorded below because changing GitHub repository settings is
  outside the runner's code/PR authorization. Same-repository collaborators with
  workflow-write access remain trusted under GitHub's standard `pull_request`
  secret model; the quality workflow itself references no secrets or variables.
- Verification: `test:deployment-ci` failed before the workflow/aggregate
  existed and passed after implementation. Clean `npm ci` and
  `npm run ci:checks` passed, including dependency/cron guards, a zero-vulnerability
  high-severity audit gate, lint with 0 errors and 11 pre-existing warnings, and
  production build. Workflow YAML parsing, `git diff --check`, CLAUDE.md's
  under-200-line guard, and edited-file diagnostics passed. PR
  `Quality gates / quality` passed on the final commit after its two red,
  actionable environment/runtime runs.
- Security: final repeated review found no issues; branch-protection and
  trusted-collaborator constraints remain documented operational notes.

### Public/deployment: site-wide security headers and CSP

- Date: 2026-09-13
- Base: `0581431667d91f087ab3efa3fa868bff703560e0`
- Final commit: `11faf44ca415b0c98f5f6edb9542e098a32b15f4`
- Scope: public/app/API/static/PWA response headers, production/development CSP,
  configured Supabase browser origins, Next.js/Vercel Analytics, Google Fonts,
  YouTube embeds, direct uploads, signed and hosted media, and CI policy checks.
- Findings: no site-wide browser security policy existed. Added enforced CSP,
  clickjacking and MIME guards, strict cross-origin referrers, a restrictive
  Permissions Policy, production HSTS, and disabled the framework fingerprint
  through one `/:path*` Next config rule. Production browser connections are
  restricted to self plus the configured HTTPS/WSS Supabase project; development
  alone receives HMR relaxations. The regression check covers the full image
  allowlist, dev/prod split, insecure-production-origin rejection, and CI wiring.
- Accepted risks: Next.js hydration and existing React/Reels styles retain
  `'unsafe-inline'`; Scheduler's accepted hosted-media contract retains
  `media-src https:`. A nonce policy would force broad dynamic rendering, and
  narrowing media requires a product URL contract first. HSTS intentionally
  does not claim unverified subdomains or preload eligibility.
- Verification: `test:security-headers` failed on the absent site-wide rule and
  passed after implementation; dependency and deployment-CI neighbors passed.
  Dependency audit found 0 vulnerabilities, lint passed with 0 errors and 11
  pre-existing warnings, production build and `git diff --check` passed, and
  edited-file diagnostics were clean. A local production server returned the
  enforced baseline on `/`, `/dashboard`, `/api/credits/packs`, `/sw.js`, and
  `/manifest.webmanifest`.
- Security: final repeated review found no issues and no unresolved critical,
  high, or medium finding.

### Public/deployment: logged-out middleware route matrix and draft hand-off

- Date: 2026-09-13
- Base: `48ce0c020bbf74d5e85c6ee1fa2899c41a3dba82`
- Final commit: `f7d15995d06e071a9e96297db7dbad38c5ce856f`
- Scope: logged-out dashboard/tool routing, protected-route hand-off, auth modal
  redirects, password/Google callback destinations, pending text/settings
  drafts, shared-path Photo/Video composers, and public Scheduler actions.
- Findings: raw drafts were copied into normal OAuth redirect URLs, exposing
  prompts/settings to URL-history and external authentication/logging
  boundaries. Removed that fallback and now ignore/strip legacy `kdraft`
  payloads; same-tab sessionStorage is the only draft store. Photo's unscoped
  parent could consume a Storyboard draft before its child mounted, and
  UI-selected Photo/Video modes plus Motion model and Photo batch settings
  could reset after sign-in. Added owner-scoped consumption and pre-paint mode
  restoration. Extracted and tested the logged-out route matrix, made legacy
  `/tools/photo` public while preserving its query redirect, retained protected
  pathname+query only inside sanitized `next`, preserved callback retry
  destinations, hardened encoded redirect separators/traversal, and gated both
  Scheduler caption actions before upload/provider work.
- Accepted risks: drafts are lost when sessionStorage is unavailable rather
  than leaked through OAuth URLs. Files/blobs remain intentionally
  non-serializable and must be re-attached; one latest draft exists per
  pathname. Public tool UIs are not authorization boundaries, so mutating and
  user-data APIs remain responsible for session, ownership, and credit checks.
- Verification: three focused seams failed against the old route, URL-draft,
  owner, settings, Scheduler, and redirect behavior, then passed after fixes.
  `test:public-auth-flow`, `test:video-studio`, deployment/dependency/security
  neighbors, a zero-vulnerability dependency audit, lint with 0 errors and 11
  pre-existing warnings, production build, `git diff --check`, CLAUDE.md size,
  and edited-file diagnostics passed. Production-server probes confirmed
  public tool rendering, protected nested-query redirects, and legacy Photo
  query preservation.
- Security: repeated final review found no issues and no unresolved critical,
  high, or medium finding.

### Public/deployment: auth modal forms and password lifecycle

- Date: 2026-09-13
- Base: `77941224bf77a8b87b340ded132c83cdddc569ae`
- Final commit: `7abffbae2fcb092c1357d322b9af73d2befbff4c`
- Scope: shared auth modal shell/provider, sign-in/sign-up/forgot/reset forms,
  password and Google entry, PKCE callback recovery handling, password-reset
  destination continuity, sign-in lockout responses, and recovery-session
  access to app pages and APIs.
- Findings: forgot-password dropped the original gated destination, expired and
  invalid retries also lost it, OAuth start errors were silent, and view changes
  could bypass per-form loading locks. Centralized nested reset URLs preserve
  only sanitized destinations; forms now surface OAuth start failures and share
  a modal-wide in-flight lock. A normal authenticated session could previously
  open the trusted reset UI with only a query flag, while a recovery link minted
  a full Supabase session that remained usable if reset was dismissed. Modern
  recovery callbacks now set an HttpOnly proof bound to the reset landing; the
  modal requires proof plus session, middleware holds proof-bearing sessions on
  that landing and rejects app APIs, and the terminal endpoint clears proof only
  after password update or successful local sign-out. Failed sign-in responses
  no longer expose their remaining lockout count.
- Accepted risks: Supabase recovery links are bearer authentication credentials
  and GoTrue still issues a full session before password update; the application
  proof gate constrains Krakatoa pages/APIs but cannot scope the upstream token
  itself. Legacy already-sent `/reset-password` links remain compatible without
  the new proof. Provider probing and distinct unconfirmed/duplicate account
  messages remain the documented, rate-limited login UX tradeoff.
- Verification: each destination, OAuth failure, modal race, invalid retry,
  proof, middleware gate, and terminal-settlement seam failed before its fix,
  then `test:auth` and `test:public-auth-flow` passed. TypeScript and edited-file
  diagnostics were clean. `ci:checks` passed with 0 dependency vulnerabilities,
  lint at 0 errors and 11 pre-existing warnings, a successful production build,
  `git diff --check`, and the CLAUDE.md under-200-line guard.
- Security: the final review confirmed the proof-clear and failed-sign-out
  bypasses closed, with 0 critical, 0 high, and 0 unaccepted medium findings.

### Public/deployment: standalone auth pages and redirect chain

- Date: 2026-09-13
- Base: `c42d8c962fc43bf580c6a8f3ce7b2bc29c589e4b`
- Final commit: `a376ad8440393b85e05f01552f7ba3ec1b2af343`
- Scope: standalone login, signup, forgot-password, and legacy reset pages;
  shared-form cross-links; OAuth/signup/recovery callback success and failure
  routing; nested destination encoding; and recovery-proof compatibility.
- Findings: login/signup/forgot cross-links dropped the sanitized `next`
  destination, and duplicate-signup navigation copied email into the URL.
  `authPageHref()` now owns those links, prevents extra parameters from
  overriding `next`, and no generated/read email query remains. The standalone
  reset page accepted any session and sat outside the proof gate; successful
  legacy recovery callbacks now canonicalize into the gated dashboard modal,
  while direct visits fail closed through a new reset request. Recovery callback
  classification is explicit instead of substring-based, and every successful
  `flow=recovery` callback sets proof even if its `next` was tampered. Redirect
  path decoding now reaches a bounded stable form and rejects excessive nesting.
- Accepted risks: a stripped `flow` marker on a modern recovery URL falls back
  to generic login failure rather than recovery-specific retry; application-
  generated links always include it. The long-lived proof cookie intentionally
  outlives an upstream Supabase refresh session and is cleared on every normal
  auth or terminal reset path, preventing the app gate from expiring first.
- Verification: all cross-link, email-query, direct/legacy reset, callback
  classification, tampered recovery, nested encoding, and extra-parameter seams
  failed before their fixes, then `test:auth` and `test:public-auth-flow` passed.
  TypeScript and edited-file diagnostics were clean. `ci:checks` passed with 0
  dependency vulnerabilities, lint at 0 errors and 11 pre-existing warnings,
  production build, `git diff --check`, and the CLAUDE.md size guard. Production
  probes returned 200 for standalone login/signup and a 307 direct-reset redirect
  preserving `next` at `/forgot-password?...&error=expired`.
- Security: final re-review found 0 critical, 0 high, and 0 unaccepted medium
  findings.

### Public/deployment: public unauthenticated read APIs

- Date: 2026-09-13
- Base: `a81df84e1932ab7747c7901d0b0f983793712ca6`
- Final commit: unchanged (review-only)
- Scope: every API GET/HEAD plus read-like POST, API middleware behavior,
  handler-local session/admin/secret gates, service-role reads, public callers,
  response fields, caching/rate limits, storage/proxy access, and provider cost.
- Findings: no accidentally public user, wallet, creation, post, storage-sign,
  admin, production-cron, or provider-work read was found. Intentional public
  responses are tool visibility, credit packs, promo state, platform Skills,
  admin cosmetic state, recovery proof state, the deprecated upload response,
  the rate-limited auth-provider hint, and the TikTok photo pull proxy. Public
  fields are minimal for their callers; authenticated routes enforce ownership
  in handlers because API middleware is only the recovery-session gate.
- Accepted risks: the TikTok photo proxy intentionally converts a constrained,
  user-first photo storage path into an unauthenticated verified-domain URL.
  `/api/auth/check-provider` intentionally reveals the Google-only case and
  performs a per-instance-rate-limited admin user scan. Public Skills expose
  platform recipes/model IDs and sign platform thumbnails. Catalog reads have
  no shared distributed rate limit; these are documented scale/DoS follow-ups,
  not current cross-user disclosure.
- Verification: public-auth, Skills, TikTok proxy, admin, creation ownership,
  storage signing, cron, and posts self-checks passed. `ci:checks` passed with 0
  dependency vulnerabilities, lint at 0 errors and 11 pre-existing warnings,
  production build, `git diff --check`, and the CLAUDE.md size guard. Anonymous
  production probes returned the expected minimal 200 shapes for config, packs,
  promo, Skills, admin/me, recovery state, and provider hint; authenticated
  creations, balance, storage sign, admin monitoring, and posts returned 401,
  cron failed closed with 503, an invalid TikTok path returned 404, and legacy
  upload returned 410.
- Security: independent inventory and security reviews found 0 critical, 0
  high, and 0 unaccepted medium findings.

### Public/deployment: marketing landing and legal pages

- Date: 2026-09-13
- Base: `ef5052cfe8319931518b6fcef316626da4bd725c`
- Final commit: `ca3807c1f5507257b3661b6f3a4ef1c90ec2a528`
- Scope: `/`, the public pricing and promo surfaces, model-labelled showreels,
  testimonials, mobile navigation, shared legal rendering, `/privacy`,
  `/terms`, `/data-deletion`, globally mounted analytics, configured marketing
  CDNs, and the CI contract that guards those public claims.
- Findings: corrected legal pages that described live Instagram OAuth as future
  work; disclosed Vercel Analytics, the opt-in YouTube embed, Cloudflare, and
  Amazon CloudFront; replaced inaccurate password-storage wording; removed
  static output-count and two-year-expiry claims that contradicted resolver and
  live 360/30/7-day settings; aligned purchase and Terms refund copy with the
  provider-commit/recoverable boundary; excluded the Nano Banana image-model
  stand-in from labelled video clips; labelled unverified testimonials as
  illustrative; linked data deletion publicly; and fixed reduced motion,
  closed-sheet focus, bilingual language, and nested heading semantics.
- Accepted risks: legal pages remain intentionally `noindex` but publicly
  linked. Dormant subscription/feature copy is not rendered. The authenticated
  promo retains intentional cosmetic launch-price anchors while checkout
  remains server-authoritative; this consumer-marketing choice is outside the
  security fix. Account deletion remains a manual support process, and
  Instagram scheduling availability remains deliberately hedged until its UI
  phase ships.
- Verification: red/green `test:public-marketing`; public-auth, admin platform
  settings, Instagram OAuth/publish, metered settlement/lifecycle, recoverable
  refund, post cleanup, and security-header checks passed. `ci:checks` passed
  with 0 dependency vulnerabilities, lint at 0 errors and 11 pre-existing
  warnings, production build, `git diff --check`, and the CLAUDE.md size guard.
  A built-server smoke test returned 200 and rendered the expected current copy
  for `/`, `/privacy`, `/terms`, and `/data-deletion`. Live expiry settings were
  read-only verified as 360/30/7 days.
- Security: final independent Standards and behavior reviews found 0 critical,
  0 high, and 0 unaccepted medium findings. The dedicated security review found
  no critical/high issue; its media-disclosure medium was fixed and its
  cosmetic promo-pricing medium is the explicit accepted product risk above.

### Public/deployment: client bundle versus server-secret boundary

- Date: 2026-09-13
- Base: `f4995097ae17b2aa6b7281db7fe0a3fbc3dd7f72`
- Final commit: `abe910c`
- Scope: every `use client` root and transitive local runtime import under
  `app`, `components`, and `lib`; browser environment access; service-role,
  provider, payment, OAuth, and cron credential adapters; Next configuration,
  production browser source maps, tracked secret-like artifacts, dotenv/key
  ignore rules, private Supabase Storage setup, and CI integration.
- Findings: no current privileged module or non-public credential was reachable
  from the 235-module client graph, and no tracked dotenv, private-key, or source
  map artifact was found. Shared credential-bearing modules nevertheless lacked
  a fail-closed client-import boundary; nine now use Next's `server-only`
  marker. The new AST self-check follows runtime imports/re-exports, rejects
  Node runtime dependencies and non-public dot/bracket/destructured env reads,
  pins the privileged markers and browser-source-map/config boundary, and runs
  in CI. Setup docs now identify the service role as server-only and the media
  bucket as private with user-first paths. Git ignored only `.env*.local`; all
  dotenv variants and common private-key bundles are now excluded.
- Accepted risks: `NEXT_PUBLIC_SUPABASE_URL` and the anon key are intentionally
  browser-visible, and `SUPABASE_STORAGE_BUCKET` is a non-secret client path
  constant. The graph resolves the repository's only configured alias (`@/`)
  plus relative literal imports; package internals and non-literal dynamic
  imports remain the production build's responsibility. The privileged-module
  marker inventory must grow when a new shared credential adapter is added.
  `.env.example` would require an explicit future ignore exception.
- Verification: red/green `test:client-secret-boundary`; dependency,
  deployment-CI, and security-header neighbors passed. Final `ci:checks` passed
  with 0 dependency vulnerabilities, lint at 0 errors and 11 pre-existing
  warnings, production build, and the CLAUDE.md size guard. `git diff --check`,
  edited-file diagnostics, concrete `git check-ignore` probes, and the tracked
  secret/source-map scan passed.
- Security: independent review found 0 critical, 0 high, and 0 unaccepted
  medium findings. Its static-check observations were either addressed
  (bracket/destructured/dynamic env reads and directive prologue handling) or
  recorded in the accepted limitations above.

## Deferred

- Public/deployment / GitHub required quality status — owner: repository admin.
  GitHub reports no `main` branch protection and no repository ruleset as of
  2026-09-13. After the `Quality gates / quality` check exists on `main`, require
  it for merges and restrict direct pushes. This is an external repository
  settings mutation outside the audit runner's code/PR authorization.

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
