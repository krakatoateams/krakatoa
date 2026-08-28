## Phase 1 — Foundation (this change)

- [x] Install `workflow@4.8.4` (package.json / lockfile)
- [x] Wrap `next.config.mjs` with `withWorkflow()`
- [x] Add `064_durable_generation_workflows.sql`
- [x] Add `lib/generation-workflows/` types, flags, control policy, workflow-db helpers
- [x] Add `npm run test:generation-workflows`
- [x] OpenSpec change under `openspec/changes/durable-generation-workflows/`

## Phase 2 — Control plane

- [x] Centralized idempotent settlement module
- [x] Extend cancel route (Stop pre/post commit, no direct refund)
- [x] Durable status API + active tile actions
- [x] Admin monitoring workflow heartbeat awareness

## Phase 3 — Pilot (this change)

- [x] Motion Control workflow + provider submission fence + Replicate webhook
- [x] Atomic workflow success finalization RPC (`068`)
- [x] `generate-motion-control` workflow branch behind `GENERATION_WORKFLOW_ENABLED_JOB_TYPES`
- [x] Read-only workflow status finalizer guard
- [x] Rollback-only live DB checks for settlement replay, provider/Stop races, and finalization
- [ ] Motion Control failure-injection matrix (manual soak)
- [ ] Enable via `GENERATION_WORKFLOW_ENABLED_JOB_TYPES=video_motion_control`

## Phase 4+ — Tool migration (future)

- [ ] Photo + Storyboard image/import
- [ ] T2V/I2V + Storyboard video
- [ ] Reels Creator (Seedance + Veo)

## Verification gates (each cutover)

- [ ] `test:generation-workflows`, `test:idempotency`, `test:generation-commit`
- [ ] `test:recoverable-refund`, `test:monitoring-flags`, `test:active-generations`
- [ ] lint + production build
