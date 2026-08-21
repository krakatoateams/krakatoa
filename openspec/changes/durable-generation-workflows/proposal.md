## Why

Metered generation routes run inside single Vercel Serverless requests capped at 300s on
Hobby. Disconnects, deploys, and long provider polling produce false failures and stuck
`running` jobs. Vercel Workflow DevKit (`workflow@4.8.4`) provides durable step execution
while Supabase remains billing and product truth.

## What Changes (Phase 1 — foundation only)

- Wrap [`next.config.mjs`](next.config.mjs) with `withWorkflow()` from `workflow/next`.
- Add migration `064_durable_generation_workflows.sql` for execution metadata on `jobs`
  and `generation_requests.provider_committed_at`.
- Add `lib/generation-workflows/` with execution-backend types, disabled-by-default
  per-job-type flags, pure control policy (`canStop` vs `refundEligible`), and DB helpers
  for workflow run attachment, heartbeat, and provider commit.
- No route migration, settlement module, or provider adapters in Phase 1.

## Capabilities

### New Capabilities

- `durable-generation-workflows`: Vercel Workflow foundation, execution metadata, rollout
  flags, and workflow-era control policy — preparatory to per-tool strangler migration.

### Modified Capabilities

- None at runtime (all flags default off; existing legacy routes unchanged).

## Impact

- **Config:** `next.config.mjs`, optional `GENERATION_WORKFLOW_ENABLED_JOB_TYPES` env.
- **Lib:** `lib/generation-workflows/*`.
- **DB:** `064_durable_generation_workflows.sql` (not applied until deploy).
- **Tests:** `npm run test:generation-workflows`.

## Non-Goals (Phase 1)

- Migrating any generate route to `start()`.
- Centralized settlement, status API changes, or active-tile UX.
- Replacing legacy `markProviderCommitted` / cancel paths.
