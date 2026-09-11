# Krakatoa engineering guide

Krakatoa is a Next.js 14 creator platform with AI video, photo, scheduling, and
social tooling. `AGENTS.md` is the detailed architecture reference; this file
keeps only the rules needed on most engineering tasks.

## Stack

- Next.js App Router, React 18, TypeScript, Tailwind CSS
- NextAuth.js with Google OAuth
- Supabase Postgres and private Storage
- Replicate for AI models and Rendi for cloud FFmpeg
- Vercel Functions and Workflow

## Commands

- Install: `npm install`
- Develop: `npm run dev`
- Build: `npm run build`
- Lint: `npm run lint`
- Apply migrations: `npm run db:setup`
- Relevant focused checks are listed in `package.json`.

## Structure

- `app/(app)/tools/`: authenticated tool interfaces
- `app/api/`: API routes and generation entry points
- `lib/`: domain logic, persistence helpers, and generation pipelines
- `components/`: shared UI
- `supabase/migrations/`: idempotent, additive database migrations
- `docs/`: architecture, operations, and generation runbooks
- `openspec/changes/`: feature proposals and implementation specs

## Critical contracts

### Credits and generation

- `credit_transactions` is the billing source of truth. Job and asset costs are
  display snapshots; usage events are analytics only.
- Resolve and validate the profile before creating provider work.
- Spend credits before every provider call.
- Insufficient balance returns HTTP 402 and creates no processing asset.
- Refund post-spend terminal failures best-effort without masking the original
  error. Never refund after provider commit unless the canonical policy says so.
- Keep spend and refund idempotency keys stable.
- Client generation keys are scoped per composer and persist across navigation;
  reuse them for identical retries, rotating only after success or input changes.
- Legacy charged routes use `lib/metered-generation/`; workflow-backed attempts
  use the atomic RPCs in `lib/generation-workflows/`.
- Prompt capture stores user prompts on jobs and assembled model prompts on the
  relevant job step. Do not persist system instructions.

### Cancellation and recovery

- The generate route owns in-flight refunds; the cancel endpoint does not.
- `cancel_allowed=false` after provider commit.
- Recoverable jobs retain credits for retry. Delegate terminal refund decisions
  to `shouldRefundRecoverableTerminal()`.
- Durable jobs choose legacy or workflow execution once and never switch.
- HTTP 202 is non-terminal and must keep the attempt locked until polling returns
  an explicit terminal status and payload.
- Provider submission fencing and signed webhook verification are mandatory.

### Storage and media

- Canonical object paths start with `{userId}/`.
- Use `MEDIA_CACHE_CONTROL` for permanent media uploads.
- UI reads must use stable cached signed URLs; never mint a fresh token for every
  render.
- Never render user media with `next/image` `unoptimized`.
- Keep recovery staging under `{userId}/resumable/{jobId}/`.
- Enforce owner-scoped lookup before signing, publishing, or linking media.

### Studio hand-offs

- Cross-tool state travels through URL parameters, not a shared client store.
- Build photo-to-video links with `animateVideoHref()` and gate them with
  `canAnimateCreation()`.
- URL creation IDs are `user_creations.id`, not `assets.id`.
- Measure image ratios through a 64px Next Image thumbnail and never override a
  ratio the user explicitly selected.

## Development rules

- Prefer premium dark-first interfaces with restrained motion.
- Reserve layout with shape-matched skeletons for content loading; spinners are
  for actions and generation progress.
- Do not reset per-item media load state in an effect. Remount by stable item key.
- Keep Reels caption preview positioning aligned with `lib/reels-pipeline/ass.ts`.
- Normalize FPS, dimensions, SAR, and pixel format before FFmpeg concat.
- Interpolate concrete prompt values and validate parsed model output.
- Keep heavy Vercel routes within the current plan's supported duration.
- Do not hardcode credit prices, storage cache-control values, or secrets.
- Server routes using the Supabase service role must enforce ownership in code.
- Run focused self-checks plus build/lint in proportion to the change.
- Never paste or commit values from `.env.local`.

## Key references

- Code/security audits: run `/audit-repo`; see `docs/agents/code-security-audit-runbook.md`.
- Generation lifecycle: `docs/generation/`
- Supabase egress: `docs/ops/supabase-egress.md`
- Admin configuration: `docs/admin/admin-config-v2-plan.md`
- Admin monitoring: `docs/admin/admin-monitoring.md`
- Durable workflows: `docs/generation/durable-workflows.md`
- Full project architecture and current invariants: `AGENTS.md`

## Agent skills

### Issue tracker

Issues live as local Markdown under `.scratch/<feature>/`. See
`docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five canonical role names. See
`docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses a single-context layout. See
`docs/agents/domain.md`.
