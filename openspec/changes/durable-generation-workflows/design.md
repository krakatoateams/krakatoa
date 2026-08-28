## Context

Accepted plan: migrate every metered generation tool to Vercel Workflow incrementally
(strangler). Supabase `jobs`, `generation_requests`, credits ledger, and assets stay
authoritative; Workflow is executor only. User chose **Stop after provider-commit with no
refund** for workflow-era jobs (differs from legacy `CANCEL_NOT_ALLOWED`).

Existing cross-cutting modules remain canonical:

- [`lib/credits-db.ts`](lib/credits-db.ts) — spend/refund
- [`lib/generation-idempotency.ts`](lib/generation-idempotency.ts) — request dedupe
- [`lib/generation-commit.ts`](lib/generation-commit.ts) — legacy provider commit
- [`lib/jobs-db.ts`](lib/jobs-db.ts) — lifecycle

## Goals / Non-Goals (Phase 1)

**Goals:**

- Enable Workflow SDK in Next.js without changing runtime behavior.
- Persist execution metadata so workflow and legacy jobs are distinguishable at creation.
- Introduce pure control policy separating **canStop** from **refundEligible**.
- Provide small DB helpers for workflow run id, heartbeat, and workflow-era commit marker.

**Non-Goals:**

- Route cutover, settlement, Replicate/Rendi adapters, status/active UI, admin monitoring
  updates, or legacy path removal.

## Decisions

### 1. Dual execution backend on `jobs`

**Decision:** `jobs.execution_backend` is `legacy` (default) or `workflow`. Set explicitly
when a route adopts Workflow; never rewrite in-flight rows.

**Rationale:** Reconcile, monitoring, and rollback can branch without inferring from null
columns.

### 2. Provider commit timestamp on `generation_requests`

**Decision:** `provider_committed_at` drives workflow-era refund eligibility;
`cancel_allowed` is still flipped false for compatibility with existing readers.

**Rationale:** Legacy code uses `cancel_allowed`; workflow policy needs an explicit commit
time without overloading that boolean.

### 3. Disabled-by-default env allowlist

**Decision:** `GENERATION_WORKFLOW_ENABLED_JOB_TYPES` comma-list; empty → all legacy.

**Rationale:** Smallest kill switch — no deploy to roll back a canary tool.

### 4. Control policy (pure)

| Signal | Rule |
|--------|------|
| `canStop` | job status is non-terminal |
| `refundEligible` | `provider_committed_at` is null |
| `canRetry` | status is `recoverable` |
| `canDismiss` | status is `failed` or `cancelled` |

Post-commit Stop: `canStop=true`, `refundEligible=false`.

### 5. Indexes (partial)

- `jobs(workflow_run_id)` where not null — run lookup.
- `jobs(heartbeat_at)` where `execution_backend='workflow'` and active statuses — stale
  sweep.

## Rollout (later phases)

1. Phase 2 — settlement + cancel/status/active tiles.
2. Phase 3 — Motion Control pilot.
3. Phases 4–6 — remaining tools.
4. Phase 7 — verification, soak, legacy removal.
