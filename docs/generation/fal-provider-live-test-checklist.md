# Fal provider live test checklist

Run once before relying on Fal, and again after changing the Fal adapter or catalog. The offline
equivalent runs in CI (`npm run test:ai-provider-guard`, `photo-e2e-self-check.ts`); this list covers
what only a real Fal account can show. Record results in the runbook's "Observed behavior" table.

Setup: `FAL_KEY` set and deployed; Fal account funded; optionally apply migrations 115-117.
Switch one tier at a time in Admin → Config v2 (see [runbook](fal-provider-runbook.md)); wait 60 s.

## Per tier: Nano Banana, Nano Banana 2, Nano Banana Pro, GPT Image 2.5 Flare

- [ ] Text-to-image: image returns, saved under `{userId}/` with permanent cache headers.
- [ ] With a reference image (upload) and with an existing library image (signed Supabase URL as
      the Fal input: confirms Fal can fetch it).
- [ ] Credits spent once at the usual price; `generation_predictions.provider = 'fal'`.
- [ ] Output URL host is `*.fal.media` (note the exact host).
- [ ] Cancel mid-run: cancel locks after submit (409), result is delivered, no refund (cancel is rejected). Note whether
      Fal billed the run.
- [ ] Failure path (e.g. a request Fal reports as failed): job fails, credits refunded exactly once. An ambiguous outcome (timeout/network) is NOT refunded until reconcile sees a Fal failed status. Note whether Fal billed the failed run (unverified).
- [ ] 402: user with too few credits gets 402 and no Fal request appears in the Fal dashboard.

## Extra for resolution/quality tiers

- [ ] Nano Banana 2 and Pro at 1K, 2K, 4K: output size matches.
- [ ] GPT Image at Low, Medium, High (credits 2 / 5 / 12), each with 0, 1 and 2+ references.
- [ ] GPT Image at 16:9 and 9:16 (explicit 1280x720 / 720x1280 sizes) plus 1:1, 3:4, 2:3, 3:2, 4:3:
      output shape matches the chosen ratio.

## Rollback and monitoring

- [ ] Switch the tier back to Replicate; next job shows `replicate`; an in-flight Fal job (started
      before the switch) still completes and cancels via Fal.
- [ ] Monitoring shows the provider per job; forced Fal failure shows the amber banner.
- [ ] Fal dashboard cost per call is in line with `provider_model_costs` (edits cost more).
- [ ] `FAL_KEY` does not appear in client bundles or logs.
