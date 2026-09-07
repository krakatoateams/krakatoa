import { failJobStep } from "@/lib/job-steps-db";
import { failJob, cancelJob } from "@/lib/jobs-db";
import { markAssetFailed } from "@/lib/assets-db";
import { refundCredits } from "@/lib/credits-db";
import { purgeResumableJobStorage } from "@/lib/pipeline-recovery/storage";
import {
  finishGenerationRequestFailure,
  finishGenerationRequestRecoverable,
} from "@/lib/generation-idempotency";
import type { MeteredErrorJson, MeteredSettlementPlan } from "./types";

export type MeteredSettlementLegacyContext = {
  profileId: string;
  userId?: string | null;
  jobId?: string | null;
  currentStepId?: string | null;
  /** Routes null out currentStepId after failStep — optional hook. */
  clearCurrentStep?: () => void;
  assetIds?: string[];
  generationRequestId?: string | null;
  creditsAmount: number;
  /** Refund idempotency namespace (e.g. product_photo or reels jobType). */
  refundJobType: string;
};

export type MeteredSettlementLegacyOpts = {
  /** When errJson carries extra fields beyond plan.errorJson (pipeline-recovery). */
  errJson?: MeteredErrorJson | Record<string, unknown>;
  /** Overrides plan.refundDescription (pipeline-recovery terminal wording). */
  refundDescription?: string;
  /** Route-specific recoverable job marking (reels markJobRecoverable). */
  markRecoverableJob?: (params: {
    profileId: string;
    jobId: string;
    errJson: MeteredErrorJson;
  }) => Promise<void>;
};

async function safeIo<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[metered-settlement] ${label} failed:`, e);
    return null;
  }
}

/** Shared legacy terminal persistence — best-effort, never throws. */
export async function persistMeteredSettlementLegacy(
  plan: MeteredSettlementPlan,
  ctx: MeteredSettlementLegacyContext,
  opts?: MeteredSettlementLegacyOpts,
): Promise<void> {
  const errJson = (opts?.errJson ?? plan.errorJson) as MeteredErrorJson;

  if (ctx.currentStepId) {
    await safeIo("failStep", () =>
      failJobStep(ctx.profileId, ctx.currentStepId!, errJson),
    );
    ctx.clearCurrentStep?.();
  }

  if (plan.failAsset && ctx.assetIds?.length) {
    for (const assetId of ctx.assetIds) {
      await safeIo("failAsset", () =>
        markAssetFailed(ctx.profileId, assetId, errJson),
      );
    }
  }

  if (ctx.jobId) {
    switch (plan.jobAction) {
      case "cancel":
        await safeIo("cancelJob", () =>
          cancelJob(ctx.profileId, ctx.jobId!, errJson),
        );
        break;
      case "fail":
        await safeIo("failJob", () => failJob(ctx.profileId, ctx.jobId!, errJson));
        break;
      case "mark_recoverable":
        if (opts?.markRecoverableJob) {
          await safeIo("markRecoverable", () =>
            opts.markRecoverableJob!({
              profileId: ctx.profileId,
              jobId: ctx.jobId!,
              errJson,
            }),
          );
        }
        break;
      case "none":
        break;
    }
  }

  if (plan.resumablePurge === "purge" && ctx.userId && ctx.jobId) {
    await safeIo("purgeResumable", () =>
      purgeResumableJobStorage(ctx.userId!, ctx.jobId!),
    );
  }

  if (plan.refundEligible) {
    const description = opts?.refundDescription ?? plan.refundDescription!;
    await safeIo("refundCredits", () =>
      refundCredits({
        profileId: ctx.profileId,
        amount: ctx.creditsAmount,
        idempotencyKey: ctx.jobId
          ? `refund:${ctx.refundJobType}:${ctx.jobId}`
          : `refund:${ctx.refundJobType}:profile:${ctx.profileId}:${Date.now()}`,
        jobId: ctx.jobId ?? null,
        description,
        metadata: {
          reason: plan.refundMetadataReason!,
          originalError: errJson,
        },
      }),
    );
  }

  if (ctx.generationRequestId) {
    if (plan.idempotencyAction === "recoverable" && ctx.jobId) {
      await safeIo("idemRecoverable", () =>
        finishGenerationRequestRecoverable({
          id: ctx.generationRequestId!,
          profileId: ctx.profileId,
          jobId: ctx.jobId!,
          errorJson: errJson,
        }),
      );
    } else if (plan.idempotencyAction === "failure") {
      await safeIo("idemFailure", () =>
        finishGenerationRequestFailure({
          id: ctx.generationRequestId!,
          profileId: ctx.profileId,
          jobId: ctx.jobId ?? null,
          errorJson: errJson,
        }),
      );
    }
  }
}
