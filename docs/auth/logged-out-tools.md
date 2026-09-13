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

Run `npm run test:public-auth-flow` when changing the route matrix, auth
redirects, modal OAuth behavior, or draft persistence.
