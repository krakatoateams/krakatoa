# Remember the AI provider per request and reject unsupported provider settings

Status: ready-for-agent
GitHub: https://github.com/krakatoateams/krakatoa/issues/395
Blocked by: 02

## Overview

The system learns to remember which AI provider handled each photo request and to refuse provider settings it cannot actually run. Users notice nothing, but a mistyped provider can no longer break a model for everyone, and a request already in progress is always cancelled with the provider that started it.

## Implementation Requirements

- Additive, idempotent migration: add `provider text not null default 'replicate'` to `generation_predictions` and `generation_provider_submissions` (NOT to `jobs`), with backfill. If any fence RPC signature changes, add new parameters with defaults and update the grant/revoke execute lines (see migration 067 and follow-ups) so old overloads are not left granted. Run `test:rpc-grants` and `test:migration-catalog`.
- Record the provider when a prediction/submission is created (photo path via the phase 2 seam).
- `app/api/generations/cancel/route.ts`: group prediction ids by recorded provider and cancel each group with that provider's adapter; never by current config. A job may later hold predictions from more than one provider.
- Code-defined catalog of supported `(provider, model)` pairs (initially only Replicate pairs for existing models; Fal pairs arrive in phase 4/5). Validate in `lib/admin-config-validation.ts` (today line ~224 accepts any non-empty provider string and only warns on unknown ones) and in `lib/model-resolver.ts` (resolver must ignore an unsupported DB pair and fall back to the code default).
- DB table for per-(provider, model) cost, admin-editable, seeded from code. Not read by billing yet.
- Pricing rule: user credit price stays ONE per feature (`credit_amount`). Admin API must reject switching a row to a different provider unless `credit_amount` is non-null, because `lib/pricing-math.ts` falls back to `provider_cost_usd` when `credit_amount` is null.
- In-flight jobs keep the provider recorded at submit time; cancel/poll/webhook route by the recorded provider.

## Technical Notes (verified in repo)

- `model_configs` already has a `provider` column; `getPhotoModel` returns `{provider, model, parameters}` but callers ignore `provider` and call Replicate, so an admin typing `fal` today would break that model (free-text provider bug).
- `KNOWN_PROVIDERS = new Set(["replicate","rendi","openai"])` in `lib/admin-config-validation.ts:27`.
- Resolver cache TTL (60 s) is the accepted switch latency; do not add invalidation.
- Fallback between providers is out of scope.

## Acceptance Criteria

- Existing rows backfill to `replicate`; default behavior unchanged; mixed-provider cancel test passes (self-check with fake adapters).
- Admin API rejects unknown or unsupported `(provider, model)` pairs and null-`credit_amount` switches with clear English errors.
- `npm run ci:checks`, `test:admin-config-validation`, `test:admin-config-persistence`, `test:rpc-grants`, `test:migration-catalog`, lint and build pass. Rollback: config stays replicate; migration is additive.

## Comments
