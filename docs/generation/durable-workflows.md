# Durable generation workflows

Status: Motion Control pilot implemented; disabled by default pending a real-provider canary.

## Contract

- Supabase remains authoritative for jobs, requests, assets, history, and credits.
- Vercel Workflow executes bounded steps after the generate route returns `202`.
- Every new job chooses one backend at creation: `legacy` or `workflow`.
- A provider submission fence allows at most one Replicate prediction per request slot.
- Provider success, its fence, and the no-refund marker are committed atomically.
- Stop is always available for active workflow jobs:
  - before provider commit: stop, clean staging, refund once;
  - after provider commit: stop and clean staging, without a refund.
- Failed/cancelled rows are soft-dismissed from the active UI; audit and ledger rows remain.

## Motion Control canary

The pilot is controlled by:

```text
GENERATION_WORKFLOW_ENABLED_JOB_TYPES=video_motion_control
```

An empty or absent value keeps every tool on the legacy executor. Use a public
`NEXTAUTH_URL` so Replicate can reach the signed callback. Set
`GENERATION_WEBHOOK_SECRET` for per-submission callback binding (local development
may fall back to `NEXTAUTH_SECRET`; production may not). `REPLICATE_WEBHOOK_SECRET`
is optional; without it the server resolves Replicate's account webhook secret.

Before enabling:

1. Deploy migrations `064`–`075`.
2. Confirm `GENERATION_WEBHOOK_SECRET`, `NEXTAUTH_URL`, and `REPLICATE_API_TOKEN`.
3. Run `npm run test:generation-workflows`, the generation regression scripts, lint, and build.
4. Enable only `video_motion_control` in preview/internal canary.
5. Exercise disconnect/reconnect, duplicate webhook, Stop before/after commit,
   provider 429/5xx, storage failure, and finalization retry.
6. Spot-check one spend, at most one eligible refund, one history row, one final
   storage object, and no false admin-monitoring anomaly.

Disable the env value to route only new jobs back to legacy. Already accepted
workflow runs continue against their persisted backend; never rewrite them.

## Ambiguous provider submission

If Replicate accepts a prediction but the HTTP response is lost, the workflow does
not submit again. It waits for the signed webhook and periodically scans a bounded
recent-prediction window for the exact callback URL. If neither confirms the
prediction within 15 minutes, the attempt closes with
`PROVIDER_SUBMISSION_STATE_UNKNOWN` and keeps credits conservatively because the
provider may have billed. Admin monitoring treats this as intentional no-refund,
not `refund_missing`.

## Abandoned run backstop

A durable run heartbeats on every poll, so a quiet job is normally still alive and the
reconcile cron leaves it to Workflow's own retries. If the heartbeat stops for an hour
(`WORKFLOW_ABANDONED_AFTER_MS`), no executor is left to finish or settle it, and
`GET /api/cron/generation-reconcile` closes it through the same atomic failure RPC the
workflow itself uses — refunding only when the provider was never committed, and
deleting the artifacts the run checkpointed but will never deliver. A user Stop that
raced the cron still wins and settles as a stop. The cron reports `settledWorkflow` and
`liveWorkflow` counts so the two cases stay distinguishable in logs.

## Composer timeout

`MOTION_CONTROL_MAX_RUNTIME_MS` is the worst case a run can take: a full ambiguous-submit
fence wait plus the entire provider poll ceiling. The Motion Control composer derives its
poll ceiling from that constant, so raising a workflow bound can never leave the UI
declaring a timeout while the run is still working.

## Live schema

Applied on Aug 21, 2026:

- `durable_generation_workflows`
- `generation_job_dismissal`
- `atomic_generation_settlement`
- `provider_submission_fence`
- `workflow_success_finalization`
- `durable_generation_control_hardening`
- `provider_submission_terminal_race`
- `durable_generation_rpc_grants`
- `workflow_failure_settlement`
- `provider_failure_prediction_binding`
- `atomic_generation_request_takeover`
- `generation_request_takeover_predictions`

The control and finalization RPCs were verified with rollback-only live database
checks; no test jobs, creations, or credit changes were retained.
