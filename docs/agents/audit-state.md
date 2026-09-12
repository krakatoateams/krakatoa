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
- [ ] Integrations: TikTok OAuth, callbacks, tokens, and publishing
- [ ] Integrations: Google/YouTube OAuth, tokens, and publishing
- [ ] Scheduler: posts, retries, concurrent publication, and cron protection
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
