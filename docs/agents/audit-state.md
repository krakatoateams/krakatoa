# Repository audit state

- Runbook: `docs/agents/code-security-audit-runbook.md`
- Runner: `/audit-repo`
- Execution mode: `auto-fix-and-merge`
- Overall status: `in_progress`

The runner owns only branches prefixed `audit-repo/`. It may commit,
fast-forward `main`, push `origin/main`, and delete those branches after every
quality gate passes. It pauses for the stop conditions in the runbook.

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
- [ ] Credits: ledger, pricing, bonus offers, and refund policy
- [ ] Payments: DOKU checkout, callbacks, signatures, and replay handling
- [ ] Storage: upload/read signing, canonical paths, cleanup, and egress
- [ ] Integrations: TikTok OAuth, callbacks, tokens, and publishing
- [ ] Integrations: Google/YouTube OAuth, tokens, and publishing
- [ ] Scheduler: posts, retries, concurrent publication, and cron protection
- [ ] Database: RLS, RPC grants, constraints, and security advisors
  - [ ] Reconcile the live Supabase Auth FK cutover with an idempotent
    `supabase/migrations/` record; production is aligned but migration `003`
    and the deferred script do not reproduce that final state safely.
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
