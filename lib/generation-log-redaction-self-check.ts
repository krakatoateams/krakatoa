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
  "./active-generations-db.ts",
  "./generation-idempotency.ts",
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

console.log("generation log redaction self-check passed");
