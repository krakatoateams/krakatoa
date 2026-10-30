# Prepare the photo path for multiple AI providers (no change for users)

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/394
Blocked by: 01

## Overview

This is behind-the-scenes preparation for letting the team pick a different AI provider for photo models later. Nothing changes for users: photos are made, cancelled and charged exactly as before. It only tidies the code so the next steps are safe.

## Implementation Requirements

- Add a small provider seam used ONLY by the `generate-photo` path: run a model (create + wait, with abort check and prediction hooks), cancel predictions, and read poll status. Implement one adapter that wraps the existing Replicate code with zero behavior change (same retries, 429 backoff, abort handling, prediction-id recording).
- Move `app/api/generate-photo/route.ts` onto the seam. Today it imports `createReplicateClient`, `extractMediaUrl`, `runWithRetry` (`lib/replicate-utils`), `isCancellation` (`lib/replicate-server`) and `uploadProductImageToReplicate`.
- Rename `ReplicateCancellationError` / `isCancellation` to provider-neutral names; keep a re-export or update all callers (`lib/generation-commit.ts`, `lib/rendi.ts`, `lib/video-upload-recovery.ts`, others found by grep).
- Add a guard self-check wired into an npm script and `ci:checks` (or an existing aggregated script): no `replicate` SDK import AND no `createReplicateClient` / `predictions.` / `runReplicateWithRetry` usage outside the provider directory, with an explicit allowlist for code not yet migrated (everything except the generate-photo path). The allowlist must shrink over time, never grow.
- Do not change billing: spend before provider call, 402, best-effort refund, stable idempotency keys, generate route owns in-flight refunds, `cancel_allowed=false` after provider commit.

## Technical Notes (verified in repo)

- Coupling bypasses the SDK import: `createReplicateClient`, `runWithRetry`, `extractMediaUrl` are re-exported via `lib/replicate-utils.ts`; `ReplicateModelRef` / `replicateRef()` live in `lib/model-resolver.ts`.
- `app/api/generations/cancel/route.ts` builds a `Replicate` client directly and calls `cancelReplicatePredictions` (not touched until phase 3).
- Other Replicate callers (generate-video, generate-canvas-text, render-editor, reels pipeline, storyboard, motion-control status/webhook) stay on the old path in this phase and go on the allowlist.
- Durable workflows (`lib/generation-workflows/`) are out of scope; `workflow-bundle-guard-self-check.ts` constrains what the workflow bundle may import, so the seam must not be imported from workflow code in this phase.

## Acceptance Criteria

- Generated photos, cancellation and refunds behave identically (same request/response shapes, same job/asset rows).
- Guard check fails when a new Replicate import is added outside the allowlist.
- `npm run ci:checks`, generation self-checks (`test:generation-commit`, `test:metered-generation`, `test:idempotency`), lint and build pass. Default provider Replicate; rollback = revert the PR.
- No UI change.

## Comments
