import {
  buildRecoverableGenerationJson,
  computeRequestHash,
  isPipelineRecoverableErrorJson,
  jobOutputToGenerationResponse,
  PIPELINE_RECOVERABLE_CODE,
  resolveLinkedJobBeginAction,
} from "./generation-idempotency-pure";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`generation-idempotency self-check: ${message}`);
}

/** ponytail: runnable without Supabase — pure idempotency / recovery contract checks. */
export function generationIdempotencySelfCheck(): void {
  assert(
    isPipelineRecoverableErrorJson({ code: PIPELINE_RECOVERABLE_CODE, message: "x" }),
    "PIPELINE_RECOVERABLE should match",
  );
  assert(!isPipelineRecoverableErrorJson({ code: "STALE_GENERATION" }), "STALE should not match");
  assert(!isPipelineRecoverableErrorJson(null), "null should not match");

  const replayBody = jobOutputToGenerationResponse({
    videoUrl: "https://signed.example/v.mp4",
    storagePath: "user-1/videos/generated/video/t2v/v.mp4",
    savedToCloud: true,
    historyItem: { id: "h1" },
  });
  assert(replayBody?.videoUrl === "https://signed.example/v.mp4", "videoUrl in replay body");
  assert(
    typeof replayBody?.storagePath === "string" && replayBody.storagePath.includes("t2v"),
    "storagePath in replay body",
  );
  assert(replayBody?.savedToCloud === true, "savedToCloud preserved");
  assert(
    (replayBody?.historyItem as { id: string })?.id === "h1",
    "historyItem preserved",
  );
  assert(jobOutputToGenerationResponse({}) === null, "empty output → null");
  assert(jobOutputToGenerationResponse(null) === null, "null output → null");

  const recoverableJson = buildRecoverableGenerationJson({
    jobId: "job-abc",
    message: "upload failed",
  });
  assert(recoverableJson.recoverable === true, "recoverable flag");
  assert(recoverableJson.jobId === "job-abc", "jobId in body");
  assert(recoverableJson.code === PIPELINE_RECOVERABLE_CODE, "code in body");
  assert(recoverableJson.refunded === false, "no refund on recoverable");

  const requestId = "req-1";
  const jobId = "job-1";
  const storedRecoverableError = {
    code: PIPELINE_RECOVERABLE_CODE,
    message: "Rendi timed out",
  };

  const succeededReplay = resolveLinkedJobBeginAction(
    { id: requestId, job_id: jobId, error_json: storedRecoverableError },
    {
      status: "succeeded",
      output: { videoUrl: "https://u/v.mp4", storagePath: "uid/videos/x.mp4" },
      error: null,
    },
  );
  assert(succeededReplay?.action === "replay", "succeeded job → replay");
  assert(succeededReplay?.action === "replay" && succeededReplay.response.resumed === true, "replay marks resumed");
  assert(
    succeededReplay?.action === "replay" &&
      typeof succeededReplay.response.storagePath === "string" &&
      succeededReplay.response.storagePath === "uid/videos/x.mp4",
    "replay carries storagePath",
  );

  const recoverableGate = resolveLinkedJobBeginAction(
    { id: requestId, job_id: jobId, error_json: storedRecoverableError },
    {
      status: "recoverable",
      output: { recovery: { step: "upload" } },
      error: { message: "upload failed" },
    },
  );
  assert(recoverableGate?.action === "recoverable", "recoverable job → recoverable action");
  assert(
    recoverableGate?.action === "recoverable" && recoverableGate.jobId === jobId,
    "recoverable carries jobId",
  );
  assert(
    recoverableGate?.action === "recoverable" &&
      recoverableGate.errorJson.code === PIPELINE_RECOVERABLE_CODE,
    "preserves stored PIPELINE_RECOVERABLE error",
  );

  const staleStartedRecoverable = resolveLinkedJobBeginAction(
    {
      id: requestId,
      job_id: jobId,
      error_json: { code: "STALE_GENERATION", message: "expired" },
    },
    {
      status: "recoverable",
      output: {},
      error: { message: "checkpoint ok, upload failed" },
    },
  );
  assert(staleStartedRecoverable?.action === "recoverable", "stale STALE + recoverable job → recoverable");
  assert(
    staleStartedRecoverable?.action === "recoverable" &&
      staleStartedRecoverable.errorJson.message === "checkpoint ok, upload failed",
    "uses job error when idempotency is not PIPELINE_RECOVERABLE",
  );

  const takeoverWouldDoubleSpend = resolveLinkedJobBeginAction(
    { id: requestId, job_id: jobId, error_json: storedRecoverableError },
    { status: "succeeded", output: {}, error: null },
  );
  assert(takeoverWouldDoubleSpend === null, "succeeded job without video output → no replay (guard null)");

  const runningJob = resolveLinkedJobBeginAction(
    { id: requestId, job_id: jobId, error_json: storedRecoverableError },
    { status: "running", output: {}, error: null },
  );
  assert(runningJob?.action === "in_progress", "running linked job blocks takeover");

  const queuedJob = resolveLinkedJobBeginAction(
    { id: requestId, job_id: jobId, error_json: null },
    { status: "queued", output: {}, error: null },
  );
  assert(queuedJob?.action === "in_progress", "queued linked job blocks takeover");

  const hashA = computeRequestHash({ b: 2, a: 1 });
  const hashB = computeRequestHash({ a: 1, b: 2 });
  assert(hashA === hashB, "computeRequestHash is key-order invariant");
  assert(
    computeRequestHash({ a: 1 }) !== computeRequestHash({ a: 2 }),
    "computeRequestHash differs on payload change",
  );
}

if (process.argv[1]?.includes("generation-idempotency-self-check")) {
  generationIdempotencySelfCheck();
  console.log("generation-idempotency self-check ok");
}
