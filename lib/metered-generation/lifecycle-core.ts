import { buildRecoverableGenerationJson } from "@/lib/generation-idempotency-pure";
import { resolveMeteredSettlement } from "./settlement-pure";
import type { MeteredSettlementLegacyOpts } from "./settlement";
import type { MeteredSettlementOptions } from "./types";

export type MeteredHttpDescriptor = {
  status: number;
  body: Record<string, unknown>;
};

export type MeteredAttemptHandle = {
  profileId: string;
  userId: string | null;
  jobId: string | null;
  generationRequestId: string | null;
  creditsSpent: boolean;
  creditsAmount: number;
  assetIds: string[];
  refundJobType: string;
};

export type BeginMeteredAttemptInput = {
  profileId: string;
  userId?: string | null;
  idempotency: {
    key: string;
    routeKey: string;
    toolKey: string;
    requestHash: string;
  };
  earlyExits?: {
    inProgressMessage?: string;
    inProgress?: MeteredHttpDescriptor;
  };
  createJobFn?: (generationRequestId: string) => Promise<string | null>;
  job?: {
    tool: string;
    jobType: string;
    provider: string;
    model: string;
    input: Record<string, unknown>;
    executionBackend?: string;
    required?: boolean;
  };
  spend: {
    amount: number;
    jobType: string;
    description: string;
    metadata: Record<string, unknown>;
    skip?: boolean;
  };
  processingAssets?: Array<{
    tool: string;
    assetType: string;
    role: string;
    provider: string;
    model: string;
    bucket?: string;
    metadata?: Record<string, unknown>;
  }>;
};

export type BeginMeteredAttemptResult =
  | { kind: "early_exit"; http: MeteredHttpDescriptor }
  | { kind: "proceed"; handle: MeteredAttemptHandle };

export type FinishMeteredAssetReady = {
  assetId: string;
  storagePath: string;
  mimeType?: string;
  durationSec?: number;
  costCredits?: number;
  metadata?: Record<string, unknown>;
};

export type FinishMeteredUsage = {
  assetId?: string | null;
  tool: string;
  provider: string;
  model: string;
  unitType: string;
  units: number;
  creditsCharged: number;
  metadata: Record<string, unknown>;
};

export type FinishMeteredSuccessInput = {
  kind: "success";
  responseJson: Record<string, unknown>;
  primaryAssetId?: string | null;
  jobOutput?: Record<string, unknown>;
  costCredits?: number;
  assetsReady?: FinishMeteredAssetReady[];
  usage?: FinishMeteredUsage;
  purgeResumable?: boolean;
};

export type FinishMeteredDeferredInput = {
  kind: "deferred";
};

export type FinishMeteredRecoverableInput = {
  kind: "recoverable";
  rawMessage: string;
  currentStepId?: string | null;
  clearCurrentStep?: () => void;
  settlementOptions?: MeteredSettlementOptions;
  settlementLegacyOpts?: MeteredSettlementLegacyOpts;
};

export type FinishMeteredTerminalInput = {
  kind: "terminal";
  cancelled: boolean;
  recoverable?: boolean;
  pricingMissing?: boolean;
  rawMessage: string;
  currentStepId?: string | null;
  clearCurrentStep?: () => void;
  skipFailAsset?: boolean;
  genericClientError?: string;
  settlementOptions?: MeteredSettlementOptions;
  settlementLegacyOpts?: MeteredSettlementLegacyOpts;
  clientErrorOverride?: string;
};

export type FinishMeteredAttemptInput =
  | FinishMeteredSuccessInput
  | FinishMeteredDeferredInput
  | FinishMeteredRecoverableInput
  | FinishMeteredTerminalInput;

export type FinishMeteredAttemptResult = {
  http?: MeteredHttpDescriptor;
};

type BeginResult =
  | { action: "proceed"; id: string }
  | { action: "replay"; response: Record<string, unknown> }
  | { action: "in_progress" }
  | { action: "conflict" }
  | { action: "recoverable"; id: string; jobId: string; errorJson: Record<string, unknown> };

/** Injectable ops — self-check uses fakes; production wires real DB helpers. */
export type MeteredLifecycleOps = {
  beginGenerationRequest: (params: {
    profileId: string;
    idempotencyKey: string;
    routeKey: string;
    toolKey: string;
    requestHash: string;
  }) => Promise<BeginResult>;
  createJob: (params: Record<string, unknown>) => Promise<{ id: string }>;
  startJob: (profileId: string, jobId: string) => Promise<void>;
  attachGenerationRequestJob: (params: {
    id: string;
    profileId: string;
    jobId: string;
    assetId?: string | null;
  }) => Promise<void>;
  spendCredits: (params: Record<string, unknown>) => Promise<void>;
  getWallet: (profileId: string) => Promise<{ balance: number } | null>;
  failJob: (
    profileId: string,
    jobId: string,
    errJson: Record<string, unknown>,
  ) => Promise<void>;
  finishGenerationRequestFailure: (params: Record<string, unknown>) => Promise<void>;
  createProcessingAsset: (params: Record<string, unknown>) => Promise<{ id: string }>;
  finishJob: (
    profileId: string,
    jobId: string,
    params: { output: Record<string, unknown>; costCredits: number },
  ) => Promise<void>;
  markAssetReady: (
    profileId: string,
    assetId: string,
    params: Record<string, unknown>,
  ) => Promise<void>;
  recordUsageEvent: (params: Record<string, unknown>) => Promise<void>;
  finishGenerationRequestSuccess: (params: Record<string, unknown>) => Promise<void>;
  purgeResumableJobStorage: (userId: string, jobId: string) => Promise<void>;
  persistMeteredSettlementLegacy: (
    plan: ReturnType<typeof resolveMeteredSettlement>,
    ctx: Record<string, unknown>,
    opts?: MeteredSettlementLegacyOpts,
  ) => Promise<void>;
  resolveMeteredSettlement: typeof resolveMeteredSettlement;
};

function isInsufficientCreditsError(e: unknown): boolean {
  return e instanceof Error && e.name === "InsufficientCreditsError";
}

async function safeIo<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[metered-lifecycle] ${label} failed:`, e);
    return null;
  }
}

function defaultInProgressHttp(message: string): MeteredHttpDescriptor {
  return {
    status: 409,
    body: { error: message, code: "GENERATION_IN_PROGRESS" },
  };
}

function defaultConflictHttp(): MeteredHttpDescriptor {
  return {
    status: 409,
    body: {
      error: "This idempotency key was already used with a different request.",
      code: "IDEMPOTENCY_CONFLICT",
    },
  };
}

function insufficientCreditsHttp(
  requiredCredits: number,
  currentBalance: number,
): MeteredHttpDescriptor {
  return {
    status: 402,
    body: { error: "Insufficient credits.", requiredCredits, currentBalance },
  };
}

export async function beginMeteredAttemptWithOps(
  input: BeginMeteredAttemptInput,
  ops: MeteredLifecycleOps,
): Promise<BeginMeteredAttemptResult> {
  const begin = await ops.beginGenerationRequest({
    profileId: input.profileId,
    idempotencyKey: input.idempotency.key,
    routeKey: input.idempotency.routeKey,
    toolKey: input.idempotency.toolKey,
    requestHash: input.idempotency.requestHash,
  });

  if (begin.action === "conflict") {
    return { kind: "early_exit", http: defaultConflictHttp() };
  }
  if (begin.action === "in_progress") {
    const custom = input.earlyExits?.inProgress;
    if (custom) return { kind: "early_exit", http: custom };
    const message =
      input.earlyExits?.inProgressMessage ??
      "Generation already in progress, please wait.";
    return { kind: "early_exit", http: defaultInProgressHttp(message) };
  }
  if (begin.action === "replay") {
    return { kind: "early_exit", http: { status: 200, body: begin.response } };
  }
  if (begin.action === "recoverable") {
    return {
      kind: "early_exit",
      http: {
        status: 503,
        body: buildRecoverableGenerationJson({
          jobId: begin.jobId,
          message:
            typeof begin.errorJson.message === "string"
              ? begin.errorJson.message
              : undefined,
        }),
      },
    };
  }

  const generationRequestId = begin.id;
  let jobId: string | null = null;

  if (input.createJobFn) {
    jobId = await input.createJobFn(generationRequestId);
  } else if (input.job) {
    const jobInput = input.job;
    const attach = async (id: string) => {
      await ops.attachGenerationRequestJob({
        id: generationRequestId,
        profileId: input.profileId,
        jobId: id,
      });
    };

    if (jobInput.required) {
      const job = await ops.createJob({
        profileId: input.profileId,
        tool: jobInput.tool,
        jobType: jobInput.jobType,
        provider: jobInput.provider,
        model: jobInput.model,
        input: jobInput.input,
        ...(jobInput.executionBackend
          ? { executionBackend: jobInput.executionBackend }
          : {}),
      });
      jobId = job.id;
      await ops.startJob(input.profileId, jobId);
      await attach(jobId);
    } else {
      const job = await safeIo("createJob", () =>
        ops.createJob({
          profileId: input.profileId,
          tool: jobInput.tool,
          jobType: jobInput.jobType,
          provider: jobInput.provider,
          model: jobInput.model,
          input: jobInput.input,
          ...(jobInput.executionBackend
            ? { executionBackend: jobInput.executionBackend }
            : {}),
        }),
      );
      if (job) {
        jobId = job.id;
        await safeIo("startJob", () => ops.startJob(input.profileId, jobId!));
        await safeIo("attachJob", () => attach(jobId!));
      }
    }
  }

  let creditsSpent = false;
  let creditsAmount = 0;

  if (!input.spend.skip) {
    try {
      await ops.spendCredits({
        profileId: input.profileId,
        amount: input.spend.amount,
        idempotencyKey: jobId
          ? `spend:${input.spend.jobType}:${jobId}`
          : `spend:${input.spend.jobType}:profile:${input.profileId}:${Date.now()}`,
        jobId,
        description: input.spend.description,
        metadata: input.spend.metadata,
      });
      creditsSpent = true;
      creditsAmount = input.spend.amount;
    } catch (e) {
      if (isInsufficientCreditsError(e)) {
        const wallet = await ops.getWallet(input.profileId).catch(() => null);
        const currentBalance = wallet?.balance ?? 0;
        const requiredCredits = input.spend.amount;
        if (jobId) {
          await safeIo("failJobInsufficient", () =>
            ops.failJob(input.profileId, jobId!, {
              code: "INSUFFICIENT_CREDITS",
              message: "Insufficient credits.",
              requiredCredits,
              currentBalance,
            }),
          );
        }
        await safeIo("idemFailInsufficient", () =>
          ops.finishGenerationRequestFailure({
            id: generationRequestId,
            profileId: input.profileId,
            jobId,
            errorJson: {
              code: "INSUFFICIENT_CREDITS",
              message: "Insufficient credits.",
              requiredCredits,
              currentBalance,
            },
          }),
        );
        return {
          kind: "early_exit",
          http: insufficientCreditsHttp(requiredCredits, currentBalance),
        };
      }
      throw e;
    }
  }

  const assetIds: string[] = [];
  if (input.processingAssets?.length) {
    for (const spec of input.processingAssets) {
      const asset = await safeIo("createAsset", () =>
        ops.createProcessingAsset({
          profileId: input.profileId,
          jobId: jobId ?? undefined,
          tool: spec.tool,
          assetType: spec.assetType,
          role: spec.role,
          ...(spec.bucket ? { bucket: spec.bucket } : {}),
          provider: spec.provider,
          model: spec.model,
          metadata: spec.metadata,
        }),
      );
      if (asset) assetIds.push(asset.id);
    }
  }

  return {
    kind: "proceed",
    handle: {
      profileId: input.profileId,
      userId: input.userId ?? null,
      jobId,
      generationRequestId,
      creditsSpent,
      creditsAmount,
      assetIds,
      refundJobType: input.spend.jobType,
    },
  };
}

export async function finishMeteredAttemptWithOps(
  handle: MeteredAttemptHandle,
  outcome: FinishMeteredAttemptInput,
  ops: MeteredLifecycleOps,
): Promise<FinishMeteredAttemptResult> {
  if (outcome.kind === "deferred") {
    return {};
  }

  if (outcome.kind === "success") {
    if (outcome.assetsReady?.length) {
      for (const asset of outcome.assetsReady) {
        await safeIo("markAssetReady", () =>
          ops.markAssetReady(handle.profileId, asset.assetId, {
            storagePath: asset.storagePath,
            mimeType: asset.mimeType,
            durationSec: asset.durationSec,
            costCredits: asset.costCredits,
            metadata: asset.metadata,
          }),
        );
      }
    }
    if (outcome.jobOutput && handle.jobId) {
      await safeIo("finishJob", () =>
        ops.finishJob(handle.profileId, handle.jobId!, {
          output: outcome.jobOutput!,
          costCredits: outcome.costCredits ?? handle.creditsAmount,
        }),
      );
    }
    if (outcome.usage) {
      await safeIo("recordUsage", () =>
        ops.recordUsageEvent({
          profileId: handle.profileId,
          jobId: handle.jobId,
          assetId: outcome.usage!.assetId ?? null,
          tool: outcome.usage!.tool,
          provider: outcome.usage!.provider,
          model: outcome.usage!.model,
          unitType: outcome.usage!.unitType,
          units: outcome.usage!.units,
          creditsCharged: outcome.usage!.creditsCharged,
          metadata: outcome.usage!.metadata,
        }),
      );
    }
    if (handle.generationRequestId) {
      await safeIo("idemSuccess", () =>
        ops.finishGenerationRequestSuccess({
          id: handle.generationRequestId!,
          profileId: handle.profileId,
          jobId: handle.jobId,
          assetId: outcome.primaryAssetId ?? handle.assetIds[0] ?? null,
          responseJson: outcome.responseJson,
        }),
      );
    }
    if (outcome.purgeResumable && handle.userId && handle.jobId) {
      await safeIo("purgeResumable", () =>
        ops.purgeResumableJobStorage(handle.userId!, handle.jobId!),
      );
    }
    return {};
  }

  const recoverable = outcome.kind === "recoverable";
  const terminal = outcome.kind === "terminal";
  const plan = ops.resolveMeteredSettlement({
    cancelled: terminal ? outcome.cancelled : false,
    recoverable,
    pricingMissing: terminal ? !!outcome.pricingMissing : false,
    rawMessage: outcome.rawMessage,
    creditsSpent: handle.creditsSpent,
    creditsAmount: handle.creditsAmount,
    hasProfileId: true,
    hasJobId: !!handle.jobId,
    jobId: handle.jobId,
    hasJobType: !!handle.refundJobType,
    hasGenerationRequestId: !!handle.generationRequestId,
    hasAsset: handle.assetIds.length > 0,
    skipFailAsset: terminal ? outcome.skipFailAsset : false,
    genericClientError: terminal ? outcome.genericClientError : undefined,
    options: outcome.settlementOptions,
  });

  await ops.persistMeteredSettlementLegacy(
    plan,
    {
      profileId: handle.profileId,
      userId: handle.userId,
      jobId: handle.jobId,
      currentStepId: outcome.currentStepId ?? null,
      clearCurrentStep: outcome.clearCurrentStep,
      assetIds: handle.assetIds.length > 0 ? handle.assetIds : undefined,
      generationRequestId: handle.generationRequestId,
      creditsAmount: handle.creditsAmount,
      refundJobType: handle.refundJobType,
    },
    outcome.settlementLegacyOpts,
  );

  let httpBody = plan.httpBody;
  if (
    terminal &&
    outcome.clientErrorOverride &&
    plan.kind !== "cancelled" &&
    plan.kind !== "recoverable"
  ) {
    httpBody = outcome.pricingMissing
      ? { error: outcome.clientErrorOverride, code: "PRICING_CONFIG_MISSING" }
      : { error: outcome.clientErrorOverride };
  }

  return { http: { status: plan.httpStatus, body: httpBody } };
}
