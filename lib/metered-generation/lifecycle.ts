import { createJob, startJob, failJob, finishJob } from "@/lib/jobs-db";
import { createProcessingAsset, markAssetReady } from "@/lib/assets-db";
import { spendCredits, getWallet } from "@/lib/credits-db";
import { recordUsageEvent } from "@/lib/usage-events-db";
import {
  beginGenerationRequest,
  attachGenerationRequestJob,
  finishGenerationRequestSuccess,
  finishGenerationRequestFailure,
} from "@/lib/generation-idempotency";
import { purgeResumableJobStorage } from "@/lib/pipeline-recovery/storage";
import { resolveMeteredSettlement } from "./settlement-pure";
import {
  persistMeteredSettlementLegacy,
  type MeteredSettlementLegacyContext,
} from "./settlement";
import {
  beginMeteredAttemptWithOps,
  finishMeteredAttemptWithOps,
  type BeginMeteredAttemptInput,
  type BeginMeteredAttemptResult,
  type FinishMeteredAttemptInput,
  type FinishMeteredAttemptResult,
  type MeteredAttemptHandle,
  type MeteredLifecycleOps,
} from "./lifecycle-core";

export type {
  BeginMeteredAttemptInput,
  BeginMeteredAttemptResult,
  FinishMeteredAttemptInput,
  FinishMeteredAttemptResult,
  MeteredAttemptHandle,
  MeteredHttpDescriptor,
  FinishMeteredAssetReady,
  FinishMeteredUsage,
} from "./lifecycle-core";

const defaultOps: MeteredLifecycleOps = {
  beginGenerationRequest,
  createJob: (params) => createJob(params as Parameters<typeof createJob>[0]),
  startJob: async (profileId, jobId) => {
    await startJob(profileId, jobId);
  },
  attachGenerationRequestJob,
  spendCredits: async (params) => {
    await spendCredits(params as Parameters<typeof spendCredits>[0]);
  },
  getWallet,
  failJob: async (profileId, jobId, errJson) => {
    await failJob(profileId, jobId, errJson);
  },
  finishGenerationRequestFailure: (params) =>
    finishGenerationRequestFailure(
      params as Parameters<typeof finishGenerationRequestFailure>[0],
    ),
  createProcessingAsset: (params) =>
    createProcessingAsset(params as Parameters<typeof createProcessingAsset>[0]),
  finishJob: async (profileId, jobId, params) => {
    await finishJob(profileId, jobId, params);
  },
  markAssetReady: async (profileId, assetId, params) => {
    await markAssetReady(profileId, assetId, params);
  },
  recordUsageEvent: async (params) => {
    await recordUsageEvent(params as Parameters<typeof recordUsageEvent>[0]);
  },
  finishGenerationRequestSuccess: (params) =>
    finishGenerationRequestSuccess(
      params as Parameters<typeof finishGenerationRequestSuccess>[0],
    ),
  purgeResumableJobStorage: async (userId, jobId) => {
    await purgeResumableJobStorage(userId, jobId);
  },
  persistMeteredSettlementLegacy: (plan, ctx, opts) =>
    persistMeteredSettlementLegacy(
      plan,
      ctx as MeteredSettlementLegacyContext,
      opts,
    ),
  resolveMeteredSettlement,
};

export async function beginMeteredAttempt(
  input: BeginMeteredAttemptInput,
): Promise<BeginMeteredAttemptResult> {
  return beginMeteredAttemptWithOps(input, defaultOps);
}

export async function finishMeteredAttempt(
  handle: MeteredAttemptHandle,
  outcome: FinishMeteredAttemptInput,
): Promise<FinishMeteredAttemptResult> {
  return finishMeteredAttemptWithOps(handle, outcome, defaultOps);
}
