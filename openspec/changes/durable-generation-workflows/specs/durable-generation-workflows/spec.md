## ADDED Requirements

### Requirement: Workflow SDK bootstrap

The application SHALL wrap Next.js config with `withWorkflow()` from `workflow/next` so
`"use workflow"` and `"use step"` directives compile. No generation route SHALL call
`start()` until its job type is explicitly enabled.

#### Scenario: Default build includes workflow plugin

- **WHEN** `next build` runs
- **THEN** the config export uses `withWorkflow(nextConfig)` and the existing image/transpile
  settings are preserved

### Requirement: Execution backend metadata

Each job SHALL record `execution_backend` (`legacy` | `workflow`), optional
`workflow_run_id`, and optional `heartbeat_at`. Existing rows SHALL default to `legacy`
without rewrite.

#### Scenario: Legacy job unchanged

- **WHEN** migration `064` is applied on a database with existing jobs
- **THEN** every existing row has `execution_backend = 'legacy'` and null workflow fields

### Requirement: Workflow-era provider commit marker

`generation_requests.provider_committed_at` SHALL record when provider output is committed
for refund policy. Workflow-era commit helpers SHALL set this timestamp and `cancel_allowed =
false` without invoking credit/refund logic.

#### Scenario: Post-commit refund ineligible

- **WHEN** `provider_committed_at` is set
- **THEN** `isRefundEligible` returns false while `canStop` may still be true for a
  non-terminal job

### Requirement: Disabled-by-default rollout flags

Every metered `job_type` SHALL have a workflow feature flag defaulting to off. Enabling
SHALL require `GENERATION_WORKFLOW_ENABLED_JOB_TYPES` to list that job type.

#### Scenario: No env override

- **WHEN** `GENERATION_WORKFLOW_ENABLED_JOB_TYPES` is unset or empty
- **THEN** `resolveExecutionBackendForJobType` returns `legacy` for all metered types

### Requirement: Pure control policy self-check

Pure control and flag logic SHALL ship with a runnable self-check invokable via
`npm run test:generation-workflows` without database access.

#### Scenario: Self-check passes in CI

- **WHEN** `npm run test:generation-workflows` runs with no workflow env override
- **THEN** the process exits 0
