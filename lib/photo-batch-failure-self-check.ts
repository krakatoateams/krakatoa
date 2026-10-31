/**
 * S2 phase 1 (#440): the batch plan counts unconfirmed (ambiguous) Fal images and the client message
 * tells the truth about them. Real: planBatchFailures, batchFailureMessage, the route and page sources.
 */
import { readFileSync } from "node:fs";
import { GenerationCancelledError, ProviderDefinitiveFailureError, isGenerationCancelled, isProviderDefinitiveFailure } from "./ai-providers/errors";
import { batchFailureMessage, planBatchFailures } from "./photo-batch-failure-pure";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`photo-batch-failure self-check failed: ${msg}`);
}

const definitive = () => new ProviderDefinitiveFailureError();
const networkLoss = () => new Error("fetch failed");
const removed = () => new GenerationCancelledError();
const plan = (rejections: unknown[], fal: boolean) =>
  planBatchFailures({
    rejections,
    commitsOnSubmit: fal,
    cancelWhileQueued: fal,
    isDefinitive: isProviderDefinitiveFailure,
    isCancelled: isGenerationCancelled,
  });

// Plan: Fal batch of 4 with 2 ok, 1 definitive, 1 network loss.
{
  const fal = plan([definitive(), networkLoss()], true);
  assert(fal.refundableFailures === 1 && fal.unconfirmedFailures === 1, "Fal mix: refundable 1, unconfirmed 1");
  const rep = plan([definitive(), networkLoss()], false);
  assert(rep.refundableFailures === 2 && rep.unconfirmedFailures === 0, "Replicate mix: all refundable, unconfirmed 0");
  assert(plan([definitive(), removed()], true).unconfirmedFailures === 0, "Fal definitive + confirmed removal: none unconfirmed");
  assert(plan([networkLoss(), networkLoss()], true).unconfirmedFailures === 2, "Fal two network losses: 2 unconfirmed");
  assert(plan([], true).unconfirmedFailures === 0 && plan([], false).unconfirmedFailures === 0, "no failures: 0");
}

// Message: unchanged text when nothing is unconfirmed (or the field is missing: older responses / replays).
{
  const today = "1 of 4 images couldn't be generated — you were only charged for the 3 that worked.";
  assert(batchFailureMessage({ failed: 1, requested: 4, delivered: 3 }) === today, "missing field: today's text");
  assert(batchFailureMessage({ failed: 1, requested: 4, delivered: 3, unconfirmed: 0 }) === today, "0 unconfirmed: today's text");
  assert(
    batchFailureMessage({ failed: 2, requested: 4, delivered: 2, unconfirmed: 1 }) ===
      "2 of 4 images didn't arrive. 1 was refunded. 1 couldn't be confirmed by the AI provider, so it is still charged for now. Contact support if it doesn't appear in your library.",
    "1 unconfirmed, 1 refunded: singular",
  );
  assert(
    batchFailureMessage({ failed: 2, requested: 4, delivered: 2, unconfirmed: 2 }) ===
      "2 of 4 images didn't arrive. 2 couldn't be confirmed by the AI provider, so they are still charged for now. Contact support if they don't appear in your library.",
    "2 unconfirmed, 0 refunded: plural, no refunded sentence",
  );
  assert(
    batchFailureMessage({ failed: 3, requested: 4, delivered: 1, unconfirmed: 1 }) ===
      "3 of 4 images didn't arrive. 2 were refunded. 1 couldn't be confirmed by the AI provider, so it is still charged for now. Contact support if it doesn't appear in your library.",
    "2 refunded: plural",
  );
  assert(!/only charged/.test(batchFailureMessage({ failed: 1, requested: 2, delivered: 1, unconfirmed: 1 })), "never claims 'only charged' when unconfirmed");
}

// Route: the new field is additive and goes to the response, job output and usage metadata;
// refund key, amount and the existing fields are untouched.
{
  const route = readFileSync("app/api/generate-photo/route.ts", "utf8");
  assert((route.match(/unconfirmedImageCount: plan\.unconfirmedFailures/g) ?? []).length === 3, "route: field in response, job output and usage metadata");
  assert((route.match(/failedImageCount: failureCount/g) ?? []).length === 2 && (route.match(/requestedImageCount: imageCount/g) ?? []).length === 2, "route: existing fields kept");
  assert(route.includes("idempotencyKey: `refund:product_photo:${jobId}:partial`") && route.includes("const failedCredits = perImageCredits * refundableFailures;"), "route: partial refund unchanged");
  const page = readFileSync("app/(app)/tools/photo-v2/page.tsx", "utf8");
  assert(page.includes("batchFailureMessage({") && page.includes("data.unconfirmedImageCount"), "page: uses the message builder with the new field");
  assert(!page.includes("you were only charged for the"), "page: no inline copy of the old wording");
  assert(/\{warning && \(\s*<div role="status"/.test(page), "page: warning is announced");
}

console.log("photo-batch-failure self-check passed");
