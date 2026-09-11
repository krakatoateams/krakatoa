# Code and security audit runbook

Use this runbook when starting a code-quality or security audit. Audit one trust
boundary at a time; a whole-repository review produces shallow and duplicated
findings.

## Automated execution

Run `/audit-repo @docs/agents/code-security-audit-runbook.md` to resume the next
unfinished slice and continue automatically until the queue is complete or a
documented stop condition is reached. Progress is persisted after every slice in
`docs/agents/audit-state.md`.

Useful variants:

- `/audit-repo status` — report progress without changing anything.
- `/audit-repo Identity` — run only the selected domain.
- Add `stop after current slice` to checkpoint and return after one slice.

## Audit queue

Work risk-first. Skip a recently audited area only when its recorded commit is an
ancestor of `HEAD` and no later change touched that area.

1. **Identity and authorization**
   - Supabase Auth configuration, session resolution, auth callbacks,
     middleware, and `requireCurrentProfile`.
   - Admin guards on pages and API routes.
   - Owner-scoped reads and writes when using the Supabase service role.
   - Expected outcomes for unauthenticated, non-admin, wrong-owner, and valid
     requests.
2. **Credits, pricing, offers, and payments**
   - Ledger RPCs, spend/refund idempotency, pricing resolution, bonus claims,
     DOKU checkout, and webhook replay handling.
   - Provider work starts only after a successful spend.
   - Refund eligibility respects provider commit and recoverable-job policy.
3. **Generation server lifecycle**
   - `lib/metered-generation/`, workflow RPCs, provider submission fences,
     cancellation, recovery, reconciliation, and generation webhooks.
   - Legacy and workflow settlement remain separate.
   - Ambiguous provider/workflow submission never resubmits or refunds eagerly.
4. **Storage and media ownership**
   - Upload-signing and read-signing routes, path validation, owner checks,
     private bucket access, cleanup, and resumable storage.
   - UI signed URLs remain stable and user media stays optimized.
   - Cross-tool IDs are resolved owner-scoped before media is linked or signed.
5. **External integrations**
   - TikTok, Google, YouTube, Replicate, Rendi, and payment callbacks.
   - OAuth state, callback binding, token storage, webhook signatures, replay
     protection, redirect allowlists, and least-privilege scopes.
6. **Scheduler, posts, and cron**
   - Post ownership, retry idempotency, duplicate publication prevention,
     terminal statuses, and cron authentication.
   - Concurrent workers cannot publish or settle the same item twice.
7. **Generation clients**
   - `lib/studio-generation-*`, composer request signatures, persistent drafts,
     deep links, polling, cancellation, retry, and history refresh.
   - One logical attempt keeps one idempotency key until success or input change.
   - Only the active composer mounts and non-terminal HTTP 202 keeps polling.
8. **Database security**
   - New migrations, RLS, RPC grants, constraints, indexes, and service-role
     assumptions.
   - Use the Supabase MCP workflow in the workspace rules for live verification.
9. **Admin and observability**
   - Admin Config, monitoring routes, anomaly classification, cross-user data
     exposure, prompt visibility, and log redaction.
10. **Public UI and deployment**
    - Auth forms, redirects, CSP/headers, dependency updates, environment
      variables, Vercel route limits, and accidental secret exposure.

The next whole-project audit should start at **Identity and authorization**.

## Slice size

A slice should contain one trust boundary, usually 2–8 implementation files plus
their tests. Split again when a review mixes unrelated state machines, providers,
or authorization models.

Examples:

- Auth session resolution and admin authorization are separate slices.
- DOKU webhook settlement and credit bonus claims are separate slices.
- Generation backend settlement and composer UI are separate slices.
- TikTok OAuth and scheduled TikTok publishing are separate slices.

## Workflow

### 1. Pin the comparison

Start from a clean, synchronized `main` and record:

```bash
git status --short --branch
git rev-parse HEAD
```

For a new change, create a branch before editing and use its starting commit as
`BASE`. For a historical audit, use the original fixed point and a path-scoped
diff. Confirm the diff is non-empty before reviewing.

An empty `git diff BASE...HEAD` means either no implementation exists yet or the
wrong branch is checked out. Inspect branches and commits instead of changing the
fixed point to hide the problem.

### 2. Run a scoped code review

The code review is read-only. Review Standards and Spec separately. Standards
come from `CLAUDE.md`, `AGENTS.md`, and area-specific docs. Spec sources are the
originating OpenSpec, implementation plan, issue, or explicit behavioral
contract.

Copy and adapt:

```text
/code-review

Fixed point: <BASE>
Review only:
- <path>
- <path>

Use:
git diff '<BASE>...HEAD' -- <paths>

Standards sources:
- CLAUDE.md
- AGENTS.md

Spec sources:
- <authoritative spec or plan>

Focus on:
- <trust boundary>
- authorization and ownership
- idempotency and concurrency
- terminal and failure behavior
- cleanup and observability

Review must remain read-only. Report confirmed findings separately from smells.
```

Classify every result as confirmed defect, accepted design, false positive, or
follow-up. A severity label alone is not proof; trace a concrete reachable path.

### 3. Fix confirmed defects with TDD

Create a branch from the recorded base before the first edit. Work one finding at
a time through a public seam.

```text
/tdd

Fix this confirmed finding:
<finding with reachable path and expected behavior>

Public seam:
<route, exported orchestrator, or client contract>

Requirements:
- write one failing regression test first
- make the minimum implementation pass
- preserve unrelated behavior
- run the focused test after each slice
```

Do not implement smells or speculative hardening in the correctness commit.
Record non-blocking cleanup separately.

### 4. Verify

Run the focused self-checks listed in `package.json`, then:

```bash
npm run lint
npm run build
git diff --check
```

Add checks that match the trust boundary:

- Generation: metered, workflow, studio-submit, active-generation, cancel, and
  recovery self-checks as applicable.
- Storage: signed-URL cache probe and owner/path tests.
- Database: migration comparison, live RPC spot checks, and Supabase security
  advisors.
- UI: desktop and mobile verification only when visuals changed.
- OAuth/webhooks: wrong state/signature, replay, expired token, and wrong-owner
  cases.

Warnings outside the diff may be recorded as pre-existing. Errors introduced by
the branch block completion.

### 5. Repeat code review, then security review

Re-run the scoped code review against the original `BASE`. Fix confirmed
Standards or Spec findings before security review.

```text
/review-security

Review this branch against its main base.
Focus on:
- authorization and ownership
- secrets and sensitive data
- billing and idempotency
- replay, race, and retry behavior
- validation and injection
- cleanup after partial failure

Do not modify code.
```

Fix high/critical findings. Fix medium findings or record an explicit accepted
risk with its reachable conditions and backstop. Low observations may become
follow-up issues when they are not exploitable or correctness-blocking.

### 6. Deliver and clean up

Commit only the slice, fast-forward `main`, push, and delete only the temporary
branch created for that slice. Verify:

```bash
git status --short --branch
git log -1 --oneline
```

Completion requires:

- no confirmed Spec defect or hard Standards violation;
- no unresolved high/critical security finding;
- focused tests, lint, build, and `git diff --check` passing;
- `main` clean and synchronized with `origin/main`;
- only the audit's own temporary branches removed.

Update architecture docs only when an invariant or system boundary changed.

## Audit record

`docs/agents/audit-state.md` is the resumable source of truth. After each slice,
update its checkbox and append the supplied audit-log template with the base and
final commit, scope, confirmed fixes, accepted risks, verification, and security
result.
