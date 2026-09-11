import {
  beginMeteredAttemptWithOps,
  finishMeteredAttemptWithOps,
  type MeteredLifecycleOps,
} from "./lifecycle-core";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

type CallLog = string[];

function makeFakeOps(log: CallLog): MeteredLifecycleOps {
  return {
    beginGenerationRequest: async () => {
      log.push("beginGenerationRequest");
      return { action: "proceed", id: "req-1" };
    },
    createJob: async () => {
      log.push("createJob");
      return { id: "job-1" } as Awaited<ReturnType<MeteredLifecycleOps["createJob"]>>;
    },
    startJob: async () => {
      log.push("startJob");
    },
    attachGenerationRequestJob: async () => {
      log.push("attachGenerationRequestJob");
    },
    spendCredits: async () => {
      log.push("spendCredits");
    },
    getWallet: async () => ({ balance: 100 } as Awaited<ReturnType<MeteredLifecycleOps["getWallet"]>>),
    failJob: async () => {
      log.push("failJob");
    },
    finishGenerationRequestFailure: async () => {
      log.push("finishGenerationRequestFailure");
    },
    createProcessingAsset: async () => {
      log.push("createProcessingAsset");
      return { id: "asset-1" } as Awaited<
        ReturnType<MeteredLifecycleOps["createProcessingAsset"]>
      >;
    },
    finishJob: async () => {
      log.push("finishJob");
    },
    markAssetReady: async () => {
      log.push("markAssetReady");
    },
    recordUsageEvent: async () => {
      log.push("recordUsageEvent");
    },
    finishGenerationRequestSuccess: async () => {
      log.push("finishGenerationRequestSuccess");
    },
    purgeResumableJobStorage: async () => {
      log.push("purgeResumableJobStorage");
    },
    persistMeteredSettlementLegacy: async () => {
      log.push("persistMeteredSettlementLegacy");
    },
    resolveMeteredSettlement: (input) => {
      log.push("resolveMeteredSettlement");
      return {
        kind: input.cancelled ? "cancelled" : input.recoverable ? "recoverable" : "generic_failure",
        message: input.rawMessage,
        errorJson: { message: input.rawMessage },
        httpStatus: input.recoverable ? 503 : input.cancelled ? 409 : 500,
        httpBody: input.recoverable
          ? { recoverable: true, jobId: input.jobId, error: input.rawMessage }
          : { error: input.rawMessage },
        failAsset: false,
        jobAction: "none",
        resumablePurge: "none",
        refundEligible: false,
        refundDescription: null,
        refundMetadataReason: null,
        idempotencyAction: "none",
        logLevel: "error",
      };
    },
  };
}

/** ponytail: runnable without Supabase — begin order + early exit mapping. */
export async function meteredLifecycleSelfCheck(): Promise<void> {
  const proceedLog: CallLog = [];
  const proceed = await beginMeteredAttemptWithOps(
    {
      profileId: "p1",
      userId: "u1",
      idempotency: {
        key: "k1",
        routeKey: "test",
        toolKey: "photo",
        requestHash: "h1",
      },
      job: {
        tool: "photo",
        jobType: "product_photo",
        provider: "replicate",
        model: "m",
        input: {},
      },
      spend: {
        amount: 4,
        jobType: "product_photo",
        description: "test",
        metadata: {},
      },
      processingAssets: [
        {
          tool: "photo",
          assetType: "image",
          role: "product_photo",
          provider: "replicate",
          model: "m",
        },
      ],
    },
    makeFakeOps(proceedLog),
  );
  assert(proceed.kind === "proceed", "proceed kind");
  assert(
    proceedLog.join(",") ===
      "beginGenerationRequest,createJob,startJob,attachGenerationRequestJob,spendCredits,createProcessingAsset",
    `begin order: ${proceedLog.join(",")}`,
  );
  assert(proceed.handle.jobId === "job-1", "handle jobId");
  assert(proceed.handle.generationRequestId === "req-1", "handle generationRequestId");
  assert(proceed.handle.creditsSpent, "credits spent");
  assert(proceed.handle.assetIds[0] === "asset-1", "asset id");

  const conflictLog: CallLog = [];
  const conflictOps = makeFakeOps(conflictLog);
  conflictOps.beginGenerationRequest = async () => {
    conflictLog.push("beginGenerationRequest");
    return { action: "conflict" };
  };
  const conflict = await beginMeteredAttemptWithOps(
    {
      profileId: "p1",
      idempotency: {
        key: "k1",
        routeKey: "test",
        toolKey: "photo",
        requestHash: "h1",
      },
      spend: { amount: 1, jobType: "x", description: "d", metadata: {} },
    },
    conflictOps,
  );
  assert(conflict.kind === "early_exit", "conflict early exit");
  assert(conflict.http.status === 409, "conflict status");
  assert(conflict.http.body.code === "IDEMPOTENCY_CONFLICT", "conflict code");
  assert(conflictLog.join(",") === "beginGenerationRequest", "conflict stops after idempotency");

  const insufficientLog: CallLog = [];
  const insufficientOps = makeFakeOps(insufficientLog);
  insufficientOps.spendCredits = async () => {
    insufficientLog.push("spendCredits");
    const err = new Error("Insufficient credits.");
    err.name = "InsufficientCreditsError";
    throw err;
  };
  const insufficient = await beginMeteredAttemptWithOps(
    {
      profileId: "p1",
      idempotency: {
        key: "k1",
        routeKey: "test",
        toolKey: "photo",
        requestHash: "h1",
      },
      job: {
        tool: "photo",
        jobType: "product_photo",
        provider: "replicate",
        model: "m",
        input: {},
      },
      spend: {
        amount: 10,
        jobType: "product_photo",
        description: "test",
        metadata: {},
      },
    },
    insufficientOps,
  );
  assert(insufficient.kind === "early_exit", "402 early exit");
  assert(insufficient.http.status === 402, "402 status");
  assert(insufficient.http.body.requiredCredits === 10, "402 required");
  assert(insufficient.http.body.currentBalance === 100, "402 balance");
  assert(
    insufficientLog.includes("beginGenerationRequest") &&
      insufficientLog.includes("createJob") &&
      insufficientLog.includes("spendCredits") &&
      insufficientLog.includes("failJob") &&
      insufficientLog.includes("finishGenerationRequestFailure") &&
      !insufficientLog.includes("createProcessingAsset"),
    `402 order (no asset): ${insufficientLog.join(",")}`,
  );

  const replayLog: CallLog = [];
  const replayOps = makeFakeOps(replayLog);
  replayOps.beginGenerationRequest = async () => {
    replayLog.push("beginGenerationRequest");
    return { action: "replay", response: { imageUrl: "https://x/y.png" } };
  };
  const replay = await beginMeteredAttemptWithOps(
    {
      profileId: "p1",
      idempotency: {
        key: "k1",
        routeKey: "test",
        toolKey: "photo",
        requestHash: "h1",
      },
      spend: { amount: 1, jobType: "x", description: "d", metadata: {} },
    },
    replayOps,
  );
  assert(replay.kind === "early_exit", "replay early exit");
  assert(replay.http.status === 200, "replay status");
  assert(replay.http.body.imageUrl === "https://x/y.png", "replay body");

  const successLog: CallLog = [];
  const handle = {
    profileId: "p1",
    userId: "u1",
    jobId: "job-1",
    generationRequestId: "req-1",
    creditsSpent: true,
    creditsAmount: 4,
    assetIds: ["asset-1"],
    refundJobType: "product_photo",
  };
  await finishMeteredAttemptWithOps(
    handle,
    {
      kind: "success",
      responseJson: { ok: true },
      jobOutput: { path: "x" },
      usage: {
        tool: "photo",
        provider: "replicate",
        model: "m",
        unitType: "images",
        units: 1,
        creditsCharged: 4,
        metadata: {},
      },
      purgeResumable: true,
    },
    makeFakeOps(successLog),
  );
  assert(
    successLog.join(",") ===
      "finishJob,recordUsageEvent,finishGenerationRequestSuccess,purgeResumableJobStorage",
    `success finish order: ${successLog.join(",")}`,
  );

  const terminalLog: CallLog = [];
  const terminal = await finishMeteredAttemptWithOps(
    handle,
    { kind: "terminal", cancelled: false, rawMessage: "boom" },
    makeFakeOps(terminalLog),
  );
  assert(terminal.http?.status === 500, "terminal http");
  assert(
    terminalLog.join(",") === "resolveMeteredSettlement,persistMeteredSettlementLegacy",
    `terminal finish: ${terminalLog.join(",")}`,
  );

  const deferred = await finishMeteredAttemptWithOps(handle, { kind: "deferred" }, makeFakeOps([]));
  assert(!deferred.http, "deferred is no-op");
}

if (process.argv[1]?.includes("lifecycle-self-check")) {
  meteredLifecycleSelfCheck().then(() => {
    console.log("metered-lifecycle self-check ok");
  });
}
