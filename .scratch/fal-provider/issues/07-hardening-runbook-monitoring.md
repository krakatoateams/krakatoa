# Verify both providers end to end, document switching and set up alerts

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/399
Blocked by: 06

## Overview

Before the second provider is relied on, the team verifies every photo model works on both providers, writes down how to switch and what to do if one provider has an outage, and sets up alerts. Users should notice only that photo generation stays reliable.

## Implementation Requirements

- End-to-end verification on both providers for all 4 tiers (t2i and with references, each resolution/quality), including cancel mid-run, failure → refund, and 402 behavior.
- Runbook under `docs/` (switching steps, Fal outage playbook, rollback = set config back to replicate, concurrency/tier check for the Fal account). Update `AGENTS.md`, `CLAUDE.md` and `docs/generation/` where they describe provider behavior.
- Monitoring/alerts for Fal errors and account balance, surfaced in the admin monitoring page.
- Backlog notes (separate later issues, not part of this one): GPT Image 2.5 Flare `xhigh`/`max` quality (needs new pricing keys and picker change; provider costs auto 0.25, xhigh 0.25, max 0.50 on Replicate); other models/video/motion control/reels (needs Fal webhook with ED25519 verification over `request_id\nuser_id\ntimestamp\nsha256hex(body)`, JWKS `https://rest.fal.ai/.well-known/jwks.json`, ±300 s window, retries without dedup, plus submission fence); provider fallback (definitive failures only, same model on the other provider).

## Technical Notes

- Fal facts are vendor-documented and unverified by us until the E2E run in this phase; record actual observed cancel billing and concurrency behavior in the runbook.

## Acceptance Criteria

- E2E checklist completed and recorded; runbook merged and linked from `AGENTS.md`/`CLAUDE.md`; alerts visible in admin monitoring.
- `npm run ci:checks`, lint and build pass. Default stays Replicate.

## Comments
