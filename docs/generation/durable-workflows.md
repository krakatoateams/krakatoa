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

## Shared lifecycle boundary

`lib/metered-generation/` now owns the route-level contract that is common to
legacy and workflow entry points: request idempotency, job creation, spending
before provider work, processing-asset creation, and response settlement.
Motion Control chooses `execution_backend` before `beginMeteredAttempt`, which
persists that choice on the job; the route then either returns the legacy
prediction `202` or starts its durable run.

The shared terminal adapter applies only to legacy attempts. Workflow Stop,
provider commit, failure, takeover, and finalization continue through the atomic
RPCs in `lib/generation-workflows/`; do not replace those calls with legacy
refund/job writes. The Motion Control composer consumes both `202` variants
through `useStudioGenerationSubmit` and keeps the same
`MOTION_CONTROL_MAX_RUNTIME_MS` polling ceiling.

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

## Video Editor export (in-system FFmpeg)

The Editor never calls Rendi. `POST /api/render-editor` validates, creates the job/asset,
starts `editorExportWorkflow` (`lib/editor-export-workflow.ts`) and returns `202`. The
client keeps the attempt locked and polls `/api/generations/status` with the same
Idempotency-Key until `succeeded` or `failed`. Cancel uses the normal idempotency cancel;
the workflow sees `cancel_requested` on its next poll (about 10s) and stops the sandbox.

Runner decision: Vercel Sandbox, driven by Workflow. A Workflow step is still bound by
the function duration, so FFmpeg runs as a detached sandbox command and short steps poll
it; no length, resolution or fps cap. The sandbox lifetime is the time budget
(`editorExportTimeoutMs`: default 40 min, clamped to the plan max, 45 min on Hobby;
override via `EDITOR_EXPORT_TIMEOUT_MS`, raise the ceiling with `EDITOR_EXPORT_PLAN_MAX_MS`).
vCPUs scale with resolution and are clamped to `EDITOR_EXPORT_MAX_VCPUS` (default 4, Hobby max).
FFmpeg is never run unverified: `npm run editor:bake-ffmpeg` bakes a Sandbox snapshot from a
pinned, SHA-256-verified static build (`lib/editor-export-pin.ts`) and Poppins; set its id as
`EDITOR_EXPORT_SNAPSHOT_ID`. Without it (local dev, previews) the same pinned download and
checksum run per export, so that path gets a longer prepare limit. Every start phase is
clamped to what is left of the start budget, under the 300s step (constants in
`lib/editor-export-pure.ts`, not env vars). Encode fails as stalled when progress stops for 5 min,
or no progress appears within 10 min while FFmpeg opens remote inputs. Both paths then assert libx264/libvpx-vp9/libopus/aac as needed,
drawtext and libfreetype. Any failure ends as `EDITOR_EXPORT_RUNNER_UNAVAILABLE`.
Create-time limits map to `EDITOR_EXPORT_BUSY` (HTTP 429) and `EDITOR_EXPORT_CAPACITY_REACHED`
(HTTP 402); the real SDK error shape is unverified. Encode polling is 3 s for the first ~2 min,
then 12 s, to stay inside the Hobby Workflow event allowance. The encoded file is uploaded straight from the
sandbox to a Supabase signed upload URL (`{userId}/` path, `MEDIA_CACHE_CONTROL`).
Storage rejects files over 50 MB (the bucket is "Unset", so the global limit applies; a signed upload
answers HTTP 400 with `"statusCode":"413"` in the body), so when a long or 4K export could pass that,
`exportVideoBitrateCapKbps` caps the video bitrate by duration to ~42 MB (x264 `-maxrate`/`-bufsize`,
VP9 constrained-quality `-b:v`) and the export dialog says so. Override the limit with
`EDITOR_EXPORT_MAX_FILE_BYTES` (server only; the dialog hint uses the 50 MB default). A file that still
overshoots fails as `EDITOR_EXPORT_FILE_TOO_LARGE`; other upload errors stay `EDITOR_EXPORT_UPLOAD_FAILED`.
Inputs are signed inside workflow steps, so no signed URL sits in the workflow payload.

Failures store/show sanitized reasons (`EDITOR_EXPORT_*` codes in `lib/editor-export-pure.ts`).
Local use needs Vercel credentials for `@vercel/sandbox` (`vercel link` + `vercel env pull`).
