# Logged-out tool access

Selected app pages render without a session so visitors can explore forms before
authentication. The page gates state-changing actions with the shared auth
modal; server APIs still enforce authentication and ownership.

## Route policy

`lib/public-route-policy.ts` is the source of truth used by `middleware.ts`.
Public logged-out entries are:

- `/dashboard`
- `/tools/photo` and `/tools/photo-v2`
- `/tools/scheduler` and `/tools/scheduler/calendar`
- `/tools/video`, `/tools/canvas`, and `/tools/editor`
- `/tools/skills` and its detail paths

Other matched `/dashboard/*`, `/tools/*`, and `/admin/*` paths redirect to the
dashboard modal. The original pathname and query are preserved as `next`.

## Draft hand-off

Gated text/settings drafts stay in same-tab `sessionStorage` and are consumed
once after sign-in. Never copy drafts into OAuth URLs: prompts and captions
would cross browser, hosting, Supabase, and identity-provider log boundaries.
If storage is unavailable, losing the draft is preferable to leaking it.

Pages with multiple composers on one pathname must include `draftOwner`, consume
with `consumePendingDraftForOwner()`, and reopen the matching composer from
`pendingDraftOwner()`. Files and blobs are intentionally excluded; affected
forms tell users to re-attach them after sign-in.

Password recovery carries the same sanitized `next` destination through the
email callback. A successful reset resumes that page; an expired link keeps the
destination on the retry form. Reset callback URLs must be built with
`passwordResetCallbackUrl()` rather than assembling nested query strings in a
component. A successful recovery callback also sets an HttpOnly proof cookie.
The reset modal requires both that proof and a session; middleware keeps
the recovery-created session on the reset landing and rejects app APIs until the
password update clears the proof. Dismissing an unfinished reset signs out the
local recovery session. A later normal password or callback sign-in clears stale
proof before entering the app.

Standalone `/login`, `/signup`, and `/forgot-password` remain fallback routes.
Their cross-links must use `authPageHref()` so a sanitized `next` survives every
step; never put the user's email in those URLs. Direct `/reset-password` visits
fail closed, while still-valid legacy email callbacks are normalized into the
proof-gated dashboard reset modal.

Run `npm run test:public-auth-flow` when changing the route matrix, auth
redirects, modal OAuth behavior, or draft persistence.
