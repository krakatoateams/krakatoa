# User-facing MCP server — let users connect their AI agent to Kelolako

**Status:** idea / design notes only. Nothing is implemented.
**Initiated by:** ryansetia1

## Goal

Let a Kelolako user connect their own AI agent (Claude Desktop, Claude Code,
Cursor, etc.) to Kelolako through MCP, so the agent can help create content with
the user's own library and credits.

The repo has no user-facing API key or MCP code today. The only API keys are
internal provider keys (Replicate, Rendi).

## Shape

A remote MCP server (Streamable HTTP) inside the existing Next.js app, e.g.
`app/api/mcp/[transport]/route.ts`, using `mcp-handler` or
`@modelcontextprotocol/sdk`.

Tool handlers must not re-implement generation. They call the existing pipelines
(`lib/metered-generation/`, `lib/generation-workflows/`) so the credit and
cancellation contracts in `CLAUDE.md` apply unchanged:

- Resolve and validate the profile, then spend credits before any provider call.
- Insufficient balance returns 402 and creates no processing asset.
- Keep spend and refund idempotency keys stable.
- HTTP 202 is non-terminal; the attempt stays locked until an explicit terminal
  status.
- Canonical object paths start with `{userId}/`; enforce owner-scoped lookup
  before signing or linking media.

## Auth

| Option | How | Fits |
|---|---|---|
| A. Personal API token | User creates a token in Settings. Store only a hash in a new `api_tokens` table (user_id, scope, last_used_at, revoked_at). Agent sends `Authorization: Bearer`. | Claude Desktop, Claude Code, Cursor. Fastest to build. |
| B. OAuth 2.1 | Supabase Auth OAuth server or a custom one. | Claude.ai-style "Connect" flow with no copy-paste. |

Start with A; add B only if users ask for it. The route resolves the token to a
`userId`. The Supabase service role bypasses RLS, so ownership must be enforced in
code on every tool.

## Candidate tools (v1)

- `list_creations`, `get_creation` — read the user's library.
- `get_credit_balance` — so the agent can check before generating.
- `generate_image`, `generate_video` — spend credits, return a `jobId`.
- `get_job_status` — the agent polls; never block on a long generation.

Later, once stable: `generate_caption`, `schedule_post`.

## Risks to decide up front

1. **Runaway spend.** Per-token daily credit cap and rate limit. Generate tools
   should expose a cost estimate before spending.
2. **Token scopes.** Separate `read` and `generate`; default to read-only.
3. **Media URLs.** Return stable cached signed URLs, never a fresh token per call.
4. **Untrusted input.** Agent-supplied text flows into model prompts; validate it
   like any other route input.
5. **Route exposure.** Add the new route to the internal-route obscurity
   self-check and review `lib/security-headers.mjs`.

## Next step

Turn this into an OpenSpec proposal under `openspec/changes/` covering token
scopes, the v1 tool list, and credit limits.
