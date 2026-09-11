import {
  STUDIO_GENERATION_ERROR_FALLBACK,
  STUDIO_GENERATION_IDEMPOTENCY_CONFLICT_FALLBACK,
  STUDIO_GENERATION_IDEMPOTENCY_KEY_REQUIRED_FALLBACK,
  STUDIO_GENERATION_IN_PROGRESS_MESSAGE,
  STUDIO_GENERATION_RECOVERABLE_FALLBACK,
  STUDIO_GENERATION_TIMEOUT_MESSAGE,
  STUDIO_GENERATION_UNEXPECTED_OK_MESSAGE,
  characterizeStudioGenerationResponse,
  classifyStudioGenerationResponse,
  describeStudioIdempotencyError,
  insufficientCreditsMessage,
  parseStudioGenerationResponse,
  parseStudioGenerationResponseText,
  recoverableStudioGenerationMessage,
} from "./studio-generation-response";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`studio-generation-response self-check: ${message}`);
}

function fakeResponse(status: number, body: string): Response {
  return new Response(body, { status });
}

/** ponytail: runnable without network — mirrors video/page.tsx response handling. */
export async function studioGenerationResponseSelfCheck(): Promise<void> {
  assert(parseStudioGenerationResponseText("", true) !== null, "empty ok body → {}");
  assert(Object.keys(parseStudioGenerationResponseText("", true)).length === 0, "empty ok → empty object");

  try {
    parseStudioGenerationResponseText("", false);
    assert(false, "empty error body should throw");
  } catch (err) {
    assert(
      err instanceof Error && err.message === STUDIO_GENERATION_TIMEOUT_MESSAGE,
      "empty error body → timeout message",
    );
  }

  try {
    parseStudioGenerationResponseText("<html>504</html>", false);
    assert(false, "non-json error body should throw");
  } catch (err) {
    assert(
      err instanceof Error && err.message === STUDIO_GENERATION_TIMEOUT_MESSAGE,
      "non-json error body → timeout message",
    );
  }

  try {
    parseStudioGenerationResponseText("not-json", true);
    assert(false, "non-json ok body should throw");
  } catch (err) {
    assert(
      err instanceof Error && err.message === STUDIO_GENERATION_UNEXPECTED_OK_MESSAGE,
      "non-json ok body → unexpected message",
    );
  }

  const parsed = parseStudioGenerationResponseText('{"videoUrl":"https://x/v.mp4"}', true);
  assert(parsed.videoUrl === "https://x/v.mp4", "valid json parses");

  assert(
    describeStudioIdempotencyError(409, { code: "GENERATION_IN_PROGRESS" }) ===
      STUDIO_GENERATION_IN_PROGRESS_MESSAGE,
    "in-progress idempotency message",
  );
  assert(
    describeStudioIdempotencyError(409, {
      code: "IDEMPOTENCY_CONFLICT",
      error: "Custom conflict",
    }) === "Custom conflict",
    "conflict uses server error",
  );
  assert(
    describeStudioIdempotencyError(409, { code: "IDEMPOTENCY_CONFLICT" }) ===
      STUDIO_GENERATION_IDEMPOTENCY_CONFLICT_FALLBACK,
    "conflict fallback",
  );
  assert(
    describeStudioIdempotencyError(400, { code: "IDEMPOTENCY_KEY_REQUIRED" }) ===
      STUDIO_GENERATION_IDEMPOTENCY_KEY_REQUIRED_FALLBACK,
    "key required fallback",
  );
  assert(describeStudioIdempotencyError(409, { code: "GENERATION_CANCELLED" }) === null, "cancelled not idempotency");

  assert(
    recoverableStudioGenerationMessage({ error: "Upload failed mid-flight" }) === "Upload failed mid-flight",
    "recoverable uses server error",
  );
  assert(
    recoverableStudioGenerationMessage({}) === STUDIO_GENERATION_RECOVERABLE_FALLBACK,
    "recoverable fallback",
  );

  assert(
    insufficientCreditsMessage({ requiredCredits: 12, currentBalance: 3 }) ===
      "Insufficient credits. Required: 12, current: 3.",
    "402 message explicit credits",
  );
  assert(
    insufficientCreditsMessage({}, 30) === "Insufficient credits. Required: 30, current: 0.",
    "402 message fallback cost",
  );

  const success = classifyStudioGenerationResponse(200, { videoUrl: "https://x/v.mp4" });
  assert(success.kind === "success" && success.data.videoUrl === "https://x/v.mp4", "200 → success");

  const deferred = classifyStudioGenerationResponse(202, { status: "processing" });
  assert(deferred.kind === "in_progress", "202 processing stays non-terminal");

  assert(classifyStudioGenerationResponse(409, { code: "GENERATION_CANCELLED" }).kind === "cancelled", "cancelled");

  const credits = classifyStudioGenerationResponse(402, { currentBalance: 1 }, { fallbackCost: 16 });
  assert(credits.kind === "insufficient_credits", "402 kind");
  assert(
    credits.kind === "insufficient_credits" && credits.message === "Insufficient credits. Required: 16, current: 1.",
    "402 message with fallback",
  );

  const recoverable503 = classifyStudioGenerationResponse(503, {
    recoverable: true,
    jobId: "job-1",
    error: "Rendi timed out",
  });
  assert(
    recoverable503.kind === "recoverable" &&
      recoverable503.jobId === "job-1" &&
      recoverable503.message === "Rendi timed out",
    "503 recoverable",
  );

  const recoverableBody = classifyStudioGenerationResponse(500, { recoverable: true, jobId: "job-reels" });
  assert(
    recoverableBody.kind === "recoverable" && recoverableBody.jobId === "job-reels",
    "body-level recoverable without 503",
  );

  const inProgress = classifyStudioGenerationResponse(409, { code: "GENERATION_IN_PROGRESS" });
  assert(
    inProgress.kind === "in_progress" && inProgress.message === STUDIO_GENERATION_IN_PROGRESS_MESSAGE,
    "in progress outcome",
  );

  const conflict = classifyStudioGenerationResponse(409, { code: "IDEMPOTENCY_CONFLICT" });
  assert(
    conflict.kind === "idempotency_conflict" &&
      conflict.message === STUDIO_GENERATION_IDEMPOTENCY_CONFLICT_FALLBACK,
    "conflict outcome",
  );

  const keyRequired = classifyStudioGenerationResponse(400, { code: "IDEMPOTENCY_KEY_REQUIRED" });
  assert(
    keyRequired.kind === "idempotency_key_required" &&
      keyRequired.message === STUDIO_GENERATION_IDEMPOTENCY_KEY_REQUIRED_FALLBACK,
    "key required outcome",
  );

  const generic = classifyStudioGenerationResponse(500, {}, { errorFallback: "Failed to generate video" });
  assert(
    generic.kind === "error" && generic.message === "Failed to generate video",
    "generic error fallback",
  );

  const serverError = classifyStudioGenerationResponse(500, { error: "Provider exploded" });
  assert(serverError.kind === "error" && serverError.message === "Provider exploded", "server error wins");

  const defaultGeneric = classifyStudioGenerationResponse(500, {});
  assert(
    defaultGeneric.kind === "error" && defaultGeneric.message === STUDIO_GENERATION_ERROR_FALLBACK,
    "default generation failed fallback",
  );

  const asyncParsed = await parseStudioGenerationResponse(
    fakeResponse(200, JSON.stringify({ storagePath: "uid/videos/x.mp4" })),
  );
  assert(asyncParsed.storagePath === "uid/videos/x.mp4", "async parse via Response");

  const characterized = await characterizeStudioGenerationResponse(
    fakeResponse(402, JSON.stringify({ requiredCredits: 8, currentBalance: 2 })),
  );
  assert(
    characterized.kind === "insufficient_credits" &&
      characterized.message === "Insufficient credits. Required: 8, current: 2.",
    "characterize end-to-end",
  );

  try {
    await characterizeStudioGenerationResponse(fakeResponse(504, ""));
    assert(false, "characterize should throw on empty error body");
  } catch (err) {
    assert(
      err instanceof Error && err.message === STUDIO_GENERATION_TIMEOUT_MESSAGE,
      "characterize propagates timeout parse error",
    );
  }
}

if (process.argv[1]?.includes("studio-generation-response-self-check")) {
  studioGenerationResponseSelfCheck()
    .then(() => {
      console.log("studio-generation-response self-check ok");
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
