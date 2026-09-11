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

- [ ] Identity: NextAuth configuration and session resolution
- [ ] Authorization: admin guards and service-role ownership checks
- [ ] Credits: ledger, pricing, bonus offers, and refund policy
- [ ] Payments: DOKU checkout, callbacks, signatures, and replay handling
- [ ] Storage: upload/read signing, canonical paths, cleanup, and egress
- [ ] Integrations: TikTok OAuth, callbacks, tokens, and publishing
- [ ] Integrations: Google/YouTube OAuth, tokens, and publishing
- [ ] Scheduler: posts, retries, concurrent publication, and cron protection
- [ ] Database: RLS, RPC grants, constraints, and security advisors
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
