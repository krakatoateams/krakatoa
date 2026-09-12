import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generationErrorLogSafe } from "./error-log-safe";
import { generationClientErrorJson } from "./generation-client-error";
import { resolveMeteredSettlement } from "./metered-generation/settlement-pure";

const baseSettlement = {
  cancelled: false,
  recoverable: false,
  pricingMissing: false,
  rawMessage: "provider failed token=secret-provider-token",
  creditsSpent: true,
  commitLocked: false,
  creditsAmount: 10,
  hasProfileId: true,
  hasJobId: true,
  jobId: "job-1",
  hasGenerationRequestId: true,
};

assert.deepEqual(resolveMeteredSettlement(baseSettlement).httpBody, {
  error: "Generation failed.",
});
assert.equal(
  resolveMeteredSettlement({
    ...baseSettlement,
    recoverable: true,
  }).httpBody.error,
  "Generation paused before delivery. Try again."
);
assert.equal(
  resolveMeteredSettlement({
    ...baseSettlement,
    pricingMissing: true,
  }).httpBody.error,
  "Pricing configuration is unavailable."
);
assert.deepEqual(
  generationClientErrorJson({
    message: "provider failed token=secret-provider-token",
    code: "PIPELINE_RECOVERABLE",
  }),
  {
    message: "Generation paused before delivery. Try again.",
    code: "PIPELINE_RECOVERABLE",
  }
);
assert.deepEqual(
  generationClientErrorJson({
    message: "internal provider detail",
    code: "INTERNAL_PROVIDER_TAXONOMY",
  }),
  { message: "Generation failed." },
  "owner responses must only expose allowlisted client contract codes"
);
const promptEchoError = Object.assign(
  new Error("Provider rejected prompt: a private launch campaign"),
  { code: "PROVIDER_FAILED", status: 502 }
);
const promptSafeLog = generationErrorLogSafe(promptEchoError);
assert.equal(promptSafeLog, "Error code=PROVIDER_FAILED status=502");
assert.ok(
  !promptSafeLog.includes("private launch campaign"),
  "generation logs must never include provider-echoed user prompts"
);

for (const relativePath of [
  "../app/api/generate-video/route.ts",
  "../app/api/generate-photo/route.ts",
  "../app/api/generate-reels/route.ts",
  "../app/api/generations/status/route.ts",
  "../app/api/generations/active/route.ts",
  "../app/api/generate-storyboard-video/route.ts",
  "../app/api/generate-motion-control/route.ts",
  "../app/api/generate-motion-control/status/route.ts",
  "../app/api/generate-canvas-text/route.ts",
  "../app/api/render-editor/route.ts",
  "../app/api/storyboards/import/route.ts",
  "../app/api/generate-caption/route.ts",
  "../app/api/test-stitch/route.ts",
  "../app/api/generations/cancel/route.ts",
  "../app/api/generations/dismiss/route.ts",
  "./active-generations-db.ts",
  "./generation-idempotency.ts",
  "./generation-commit.ts",
  "./generation-cancel.ts",
  "./tool-access.ts",
  "./pricing-resolver.ts",
  "./model-resolver.ts",
  "./feature-model-configs-db.ts",
  "./photo-storyboard-generation.ts",
  "./motion-control-finalize.ts",
  "./generation-workflows/motion-control-workflow-core.ts",
  "./generation-workflows/motion-control-workflow.ts",
  "./pipeline-recovery/storage.ts",
  "./metered-generation/lifecycle-core.ts",
  "./metered-generation/settlement.ts",
  "./reels-pipeline/storage.ts",
]) {
  const source = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  assert.match(
    source,
    /generationErrorLogSafe/,
    `${relativePath} must redact operational errors`
  );
  assert.doesNotMatch(
    source,
    /(?:Error|pipeline error|failed):", (?:error|e|historyErr)\)/,
    `${relativePath} still logs a raw Error object`
  );
}

const reelsLlm = readFileSync(
  new URL("./reels-pipeline/llm.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  reelsLlm,
  /console\.(?:warn|error)\([\s\S]{0,180}(?:lastRaw|styleRawJson)/,
  "Reels logs must not emit raw LLM output"
);

const reelsTts = readFileSync(
  new URL("./reels-pipeline/tts-whisper.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  reelsTts,
  /console\.error\([^;]*ttsRes/,
  "Reels logs must not dump provider output objects"
);

const rendiSource = readFileSync(
  new URL("./rendi.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  rendiSource,
  /throw new Error\([^;]*(?:errText|JSON\.stringify\(data)/,
  "Rendi exceptions must not embed provider response bodies"
);

const videoRoute = readFileSync(
  new URL("../app/api/generate-video/route.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  videoRoute,
  /NextResponse\.json\(\{ error: rawMessage \}/,
  "video fallback responses must not expose provider errors"
);

const replicateUtils = readFileSync(
  new URL("./replicate-utils.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  replicateUtils,
  /REPLICATE_API_TOKEN is not set/,
  "provider configuration errors must not expose environment variable names"
);

const lifecycleSource = readFileSync(
  new URL("./metered-generation/lifecycle-core.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  lifecycleSource,
  /message:\s*[\s\S]{0,100}begin\.errorJson\.message/,
  "recoverable idempotency replays must not expose stored provider text"
);
assert.match(
  lifecycleSource,
  /message: RECOVERABLE_GENERATION_CLIENT_ERROR/,
  "recoverable replays must use the shared generic client message"
);
assert.match(
  lifecycleSource,
  /refunded: persisted\.refunded/,
  "metered cancel responses must report the actual refund result"
);
assert.doesNotMatch(
  lifecycleSource,
  /spend:\$\{input\.spend\.jobType\}:profile:/,
  "metered spends must require a stable job-scoped idempotency key"
);

const statusRoute = readFileSync(
  new URL("../app/api/generations/status/route.ts", import.meta.url),
  "utf8"
);
assert.match(
  statusRoute,
  /error: generationClientErrorJson\(params\.error\)/,
  "status polling must not expose persisted provider errors"
);

const activePure = readFileSync(
  new URL("./active-generations-pure.ts", import.meta.url),
  "utf8"
);
assert.match(
  activePure,
  /generationClientErrorMessage\(error\)/,
  "active-generation tiles must not expose persisted provider errors"
);

const resumeRoute = readFileSync(
  new URL("../app/api/generations/resume/route.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  resumeRoute,
  /error: message|RENDI_API_KEY is not set/,
  "resume responses must not expose persisted errors or environment names"
);
assert.match(
  resumeRoute,
  /error: RECOVERABLE_GENERATION_CLIENT_ERROR/,
  "recoverable resumes must use the shared generic client message"
);

const creditTransactionsRoute = readFileSync(
  new URL("../app/api/credits/transactions/route.ts", import.meta.url),
  "utf8"
);
assert.match(
  creditTransactionsRoute,
  /items\.map\(\(\{ metadata, \.\.\.item \}\) =>/,
  "owner ledger responses must omit internal originalError metadata"
);

const secondarySources = [
  "../app/api/generate-storyboard-video/route.ts",
  "../app/api/storyboards/import/route.ts",
  "./photo-storyboard-generation.ts",
  "../app/api/generate-canvas-text/route.ts",
  "../app/api/render-editor/route.ts",
  "../app/api/generate-caption/route.ts",
  "../app/api/test-stitch/route.ts",
].map((path) => readFileSync(new URL(path, import.meta.url), "utf8"));
for (const source of secondarySources) {
  assert.doesNotMatch(
    source,
    /NextResponse\.json\(\{\s*error: (?:rawMessage|error\.message)/,
    "secondary generation 500s must not expose provider errors"
  );
  assert.doesNotMatch(
    source,
    /REPLICATE_API_TOKEN is not configured|RENDI_API_KEY is not set/,
    "secondary responses must not expose environment variable names"
  );
}

const testStitchSource = secondarySources[secondarySources.length - 1];
assert.doesNotMatch(
  testStitchSource,
  /Full SUCCESS response|Full response|Whisper done\. Result preview/,
  "admin test generation logs must not dump provider output"
);

const generationCancelSource = readFileSync(
  new URL("./generation-cancel.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  generationCancelSource,
  /console\.(?:warn|error)\([\s\S]{0,160}error\.message/,
  "generation cancellation logs must not emit raw DB messages"
);

const motionStatusSource = readFileSync(
  new URL(
    "../app/api/generate-motion-control/status/route.ts",
    import.meta.url
  ),
  "utf8"
);
assert.doesNotMatch(
  motionStatusSource,
  /failMotionControlAttempt\(motionCtx, errJson, \{ refund: true \}\)/,
  "motion-control status must not refund unconditionally after provider commit"
);
assert.match(
  motionStatusSource,
  /isProviderCommitLocked\([\s\S]{0,180}failMotionControlAttempt\(motionCtx, errJson, \{ refund \}\)/,
  "motion-control status refunds must honor the provider commit lock"
);
assert.doesNotMatch(
  motionStatusSource,
  /NextResponse\.json\(\{ error: errJson\.message \}/,
  "motion-control status must not return internal failure text"
);
assert.doesNotMatch(
  motionStatusSource,
  /refunded:\s*failedCredits > 0/,
  "motion-control replay must not infer refunds from the charged amount"
);
assert.match(
  motionStatusSource,
  /failedJob\s*\?\s*await hasSuccessfulRefund/,
  "motion-control replay must report the actual ledger refund"
);
assert.match(
  motionStatusSource,
  /refunded: failure\.refunded/,
  "live motion-control cancel responses must report the actual refund result"
);

const motionFinalizeSource = readFileSync(
  new URL("./motion-control-finalize.ts", import.meta.url),
  "utf8"
);
assert.match(
  motionFinalizeSource,
  /options: \{ cancelled\?: boolean; refund: boolean \}/,
  "motion failure callers must make an explicit refund decision"
);
assert.doesNotMatch(
  motionFinalizeSource,
  /refund:video_motion_control:profile:/,
  "motion refunds must require the stable job-scoped idempotency key"
);

const canvasTextSource = readFileSync(
  new URL("../app/api/generate-canvas-text/route.ts", import.meta.url),
  "utf8"
);
assert.match(
  canvasTextSource,
  /refunded = refundResult !== null[\s\S]{0,700}refunded,/,
  "canvas cancel responses must report the actual refund result"
);
assert.doesNotMatch(
  canvasTextSource,
  /(?:spend|refund):canvas_text:profile:/,
  "canvas billing must require stable job-scoped idempotency keys"
);

const photoGenerationSource = readFileSync(
  new URL("../app/api/generate-photo/route.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  photoGenerationSource,
  /refund:product_photo:profile:/,
  "partial photo refunds must use stable job-scoped idempotency keys"
);

const meteredSettlementSource = readFileSync(
  new URL("./metered-generation/settlement.ts", import.meta.url),
  "utf8"
);
assert.doesNotMatch(
  meteredSettlementSource,
  /refund:\$\{ctx\.refundJobType\}:profile:/,
  "metered refunds must require a stable job-scoped idempotency key"
);

console.log("generation log redaction self-check passed");
