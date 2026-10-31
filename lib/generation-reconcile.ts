import { supabaseServer } from "@/lib/supabase-server";
import {
  LOCK_TTL_MS,
  finishGenerationRequestFailure,
  finishGenerationRequestRecoverable,
  PIPELINE_RECOVERABLE_CODE,
} from "@/lib/generation-idempotency";
import { failJob, markJobRecoverable, getJob } from "@/lib/jobs-db";
import { refundCredits } from "@/lib/credits-db";
import { runResumableStorageReconcile } from "@/lib/pipeline-recovery/reconcile";
import { parseRecoveryManifest } from "@/lib/pipeline-recovery/manifest";
import { isWorkflowRunAbandoned } from "@/lib/generation-workflows/stop-settlement-pure";
import { settleWorkflowFailure } from "@/lib/generation-workflows/stop-settlement-core";
import { getGenerationRequestForJob } from "@/lib/generation-workflows/workflow-db";
import { isProviderCommitLocked } from "@/lib/generation-commit";
import { shouldRefundSpentCreditsAfterFailure } from "@/lib/generation-commit-pure";
import { listPredictionIdsByProvider } from "@/lib/generation-cancel";
import { getPhotoProviderById } from "@/lib/ai-providers";
import {
  PROVIDER_OUTCOME_UNKNOWN_CODE,
  PROVIDER_OUTCOME_UNRESOLVED_CLIENT_ERROR,
  PROVIDER_OUTCOME_UNRESOLVED_CODE,
} from "@/lib/generation-client-error";
import {
  SETTLED_CONFIRM_TIMEOUT_MS,
  SETTLED_ITEMS_BUDGET_MS,
  SETTLED_ITEMS_RUN_DEADLINE_MS,
  expireSettledJob,
  reconcileSettledProviderFailure,
  scanSettledJobs,
  settledWindows,
  withTimeout,
  type SettledCursor,
  type SettledFailureOps,
} from "@/lib/generation-reconcile-settled";
import { settleBatchItem, type BatchItemOps } from "@/lib/generation-batch-items-pure";
import {
  batchItemsTableReady,
  claimBatchItemDelivery,
  countOpenBatchItems,
  fetchOpenBatchItems,
  finishBatchItemDelivery,
  markBatchItemRefund,
  settleAmbiguousBatchItem,
} from "@/lib/generation-batch-items-db";
import { GENERATED_PHOTO_MIME, saveGeneratedProductPhoto } from "@/lib/product-photo-storage";
import { markAssetReady } from "@/lib/assets-db";
import { mediaExists } from "@/lib/media-storage";
import { insertProductPhotoGeneration } from "@/lib/product-photo-db";
import type { ModelPoseId, PhotoStyleId } from "@/lib/product-photo";

/** Buffer beyond idempotency lock TTL before treating a run as abandoned. */
const RECONCILE_BUFFER_MS = 5 * 60 * 1000;
type SettledRow = { id: string; profile_id: string; cost_credits?: number; updated_at: string };

export type GenerationReconcileResult = {
  /** Rows past the stale cutoff that were examined, acted on or not. */
  staleJobs: number;
  refundedJobs: number;
  /** Abandoned durable runs settled terminally by this pass. */
  settledWorkflowJobs: number;
  /** Durable runs left alone because their heartbeat is still recent enough. */
  liveWorkflowJobs: number;
  staleRequests: number;
  expiredRecoverable: number;
  sweptResumableFolders: number;
  /** Held Fal jobs not visited this run (budget spent); picked up next run. */
  settledLeft: number;
  /** Held Fal jobs past the lookback with no confirmation, marked unresolved this run. */
  unresolvedJobs: number;
  /** Per-image (S2) rows refunded after Fal confirmed that image failed. */
  itemsRefunded: number;
  /** Per-image rows Fal confirmed finished, saved into the owner's library by reconcile (late delivery). */
  itemsDeliveredLate: number;
  /** Per-image rows nothing can confirm any more (manual review). */
  itemsUnresolved: number;
  /** Per-image rows not visited this run (budget spent). */
  itemsLeft: number;
  /** True while migration 119 is not applied (the per-image scan is skipped). */
  itemsScanSkipped: boolean;
  errors: string[];
};

async function userIdForProfile(profileId: string): Promise<string> {
  const { data, error } = await supabaseServer
    .from("profiles")
    .select("user_id")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as { user_id?: string } | null)?.user_id ?? "";
}

async function hasRefundForJob(jobId: string): Promise<boolean> {
  const { data, error } = await supabaseServer
    .from("credit_transactions")
    .select("id")
    .eq("job_id", jobId)
    .eq("type", "refund")
    .eq("status", "succeeded")
    .limit(1);
  if (error) throw new Error(error.message);
  return ((data as { id: string }[] | null) ?? []).length > 0;
}

async function refundedAmountForJob(jobId: string): Promise<number> {
  const { data, error } = await supabaseServer
    .from("credit_transactions")
    .select("amount")
    .eq("job_id", jobId)
    .eq("type", "refund")
    .eq("status", "succeeded");
  if (error) throw new Error(error.message);
  return ((data as { amount?: number }[] | null) ?? []).reduce((sum, r) => sum + Math.abs(r.amount ?? 0), 0);
}

/**
 * A commit-on-submit provider (Fal) run is refundable at reconcile only when Fal's queue status
 * confirms EVERY recorded prediction failed. Unknown, pending, succeeded or unreachable => false.
 */
function providerConfirmsDefinitiveFailure(profileId: string, generationRequestId: string): Promise<boolean> {
  return withTimeout(confirmDefinitiveFailure(profileId, generationRequestId), SETTLED_CONFIRM_TIMEOUT_MS, false);
}

async function confirmDefinitiveFailure(profileId: string, generationRequestId: string): Promise<boolean> {
  try {
    const byProvider = await listPredictionIdsByProvider(profileId, generationRequestId);
    let checked = 0;
    for (const [providerId, ids] of Object.entries(byProvider)) {
      const provider = getPhotoProviderById(providerId);
      if (!provider?.commitsOnSubmit) return false;
      for (const id of ids) {
        if ((await provider.getPredictionStatus(id)).status !== "failed") return false;
        checked += 1;
      }
    }
    return checked > 0;
  } catch {
    return false;
  }
}

/** Honest final state for a held job Fal never confirmed: keeps the failed status, drops the refund promise. */
async function markSettledJobUnresolved(job: { id: string; profileId: string }): Promise<void> {
  const { error } = await supabaseServer
    .from("jobs")
    .update({
      error: { code: PROVIDER_OUTCOME_UNRESOLVED_CODE, message: PROVIDER_OUTCOME_UNRESOLVED_CLIENT_ERROR },
    })
    .eq("id", job.id)
    .eq("profile_id", job.profileId)
    .eq("status", "failed")
    .eq("error->>code", PROVIDER_OUTCOME_UNKNOWN_CODE);
  if (error) throw new Error(error.message);
}

async function spendAmountForJob(jobId: string): Promise<number> {
  const { data, error } = await supabaseServer
    .from("credit_transactions")
    .select("amount")
    .eq("job_id", jobId)
    .eq("type", "spend")
    .eq("status", "succeeded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const row = data as { amount?: number } | null;
  return typeof row?.amount === "number" ? row.amount : 0;
}

/**
 * Backstop for legacy Vercel kills, plus the last resort for durable runs whose
 * executor died without ever settling them.
 */
export async function runGenerationReconcile(): Promise<GenerationReconcileResult> {
  const runStart = Date.now();
  const cutoff = new Date(Date.now() - LOCK_TTL_MS - RECONCILE_BUFFER_MS).toISOString();
  const result: GenerationReconcileResult = {
    staleJobs: 0,
    refundedJobs: 0,
    settledWorkflowJobs: 0,
    liveWorkflowJobs: 0,
    staleRequests: 0,
    expiredRecoverable: 0,
    sweptResumableFolders: 0,
    settledLeft: 0,
    unresolvedJobs: 0,
    itemsRefunded: 0,
    itemsDeliveredLate: 0,
    itemsUnresolved: 0,
    itemsLeft: 0,
    itemsScanSkipped: false,
    errors: [],
  };

  const resumableResult = await runResumableStorageReconcile();
  result.expiredRecoverable = resumableResult.expiredRecoverable;
  result.sweptResumableFolders = resumableResult.sweptFolders;
  result.errors.push(...resumableResult.errors);

  const { data: staleJobs, error: jobsError } = await supabaseServer
    .from("jobs")
    .select(
      "id, profile_id, cost_credits, output, job_type, execution_backend, heartbeat_at, updated_at",
    )
    .eq("status", "running")
    .lt("updated_at", cutoff)
    .limit(50);

  if (jobsError) {
    result.errors.push(`jobs query: ${jobsError.message}`);
  } else {
    for (const row of (staleJobs as {
      id: string;
      profile_id: string;
      cost_credits?: number;
      output?: Record<string, unknown>;
      job_type?: string;
      execution_backend?: string | null;
      heartbeat_at?: string | null;
      updated_at: string;
    }[] | null) ?? []) {
      result.staleJobs += 1;
      try {
        const recovery = parseRecoveryManifest(row.output);
        if (recovery) {
          await markJobRecoverable(row.profile_id, row.id, {
            recovery: recovery as unknown as Record<string, unknown>,
            error: {
              code: "STALE_RECOVERABLE",
              message:
                "Generation interrupted with recoverable artifacts. Resume from the app or wait for expiry.",
            },
          });
          continue;
        }

        if (row.execution_backend === "workflow") {
          // Workflow owns retries and can outlive this legacy TTL, so only settle a
          // run whose heartbeat says no executor is left to finish or refund it.
          if (!isWorkflowRunAbandoned(row.heartbeat_at, row.updated_at)) {
            result.liveWorkflowJobs += 1;
            continue;
          }
          const request = await getGenerationRequestForJob(row.profile_id, row.id);
          if (!request) {
            result.errors.push(`job ${row.id}: abandoned durable run has no generation request`);
            continue;
          }
          await settleWorkflowFailure({
            profileId: row.profile_id,
            userId: await userIdForProfile(row.profile_id),
            jobId: row.id,
            generationRequestId: request.id,
            errorJson: {
              code: "STALE_WORKFLOW_GENERATION",
              message:
                "Generation stopped reporting progress and was closed. Credits were refunded if the provider had not started.",
            },
          });
          result.settledWorkflowJobs += 1;
          continue;
        }

        const refunded = await hasRefundForJob(row.id);
        if (!refunded) {
          const amount = await spendAmountForJob(row.id);
          const refundAmount = amount > 0 ? amount : row.cost_credits ?? 0;
          const request = await getGenerationRequestForJob(row.profile_id, row.id);
          const commitLocked = request
            ? await isProviderCommitLocked(row.profile_id, request.id)
            : false;
          if (
            shouldRefundSpentCreditsAfterFailure({
              creditsSpent: true,
              creditsAmount: refundAmount,
              commitLocked,
              definitiveProviderFailure:
                commitLocked && request
                  ? await providerConfirmsDefinitiveFailure(row.profile_id, request.id)
                  : false,
            })
          ) {
            await refundCredits({
              profileId: row.profile_id,
              amount: refundAmount,
              idempotencyKey: `refund:reconcile:${row.id}`,
              jobId: row.id,
              description: "Refund after stale generation (reconcile cron)",
              metadata: { reason: "stale_generation", reconciledAt: new Date().toISOString() },
            });
            result.refundedJobs += 1;
          }
        }
        await failJob(row.profile_id, row.id, {
          code: "STALE_GENERATION",
          message: "Generation timed out or was interrupted. Credits were refunded if charged.",
        });
      } catch (e) {
        result.errors.push(`job ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  // Fal runs the route settled as failed with credits held (ambiguous outcome): refund only on a
  // Fal-confirmed failure. Every candidate in the 72 h window is visited, paged and time-budgeted;
  // leftovers wait for the next (overlapping) run. Past the window, one last attempt then "unresolved".
  const windows = settledWindows(Date.now());
  const settledOps: SettledFailureOps = {
    refundedAmount: refundedAmountForJob,
    spendAmount: spendAmountForJob,
    getRequestId: async (profileId, jobId) => (await getGenerationRequestForJob(profileId, jobId))?.id ?? null,
    isCommitLocked: isProviderCommitLocked,
    confirmsFailure: providerConfirmsDefinitiveFailure,
    refund: refundCredits,
  };
  const toJob = (r: SettledRow) => ({ id: r.id, profileId: r.profile_id, costCredits: r.cost_credits ?? 0, updatedAt: r.updated_at });
  const settledQuery = (w: { after: string; before: string }, code: string, cursor: SettledCursor, head: boolean) => {
    let q = supabaseServer
      .from("jobs")
      .select("id, profile_id, cost_credits, updated_at", head ? { count: "exact", head: true } : undefined)
      .eq("status", "failed")
      .eq("error->>code", code)
      .gt("updated_at", w.after)
      .lt("updated_at", w.before);
    if (cursor) q = q.or(`updated_at.gt.${cursor.updatedAt},and(updated_at.eq.${cursor.updatedAt},id.gt.${cursor.id})`);
    return q;
  };
  const scanSettled = (w: { after: string; before: string }, processJob: (j: ReturnType<typeof toJob>) => Promise<string>) =>
    scanSettledJobs({
      fetchPage: async (cursor, limit) => {
        const { data, error } = await settledQuery(w, PROVIDER_OUTCOME_UNKNOWN_CODE, cursor, false)
          .order("updated_at", { ascending: true })
          .order("id", { ascending: true })
          .limit(limit);
        if (error) throw new Error(error.message);
        return ((data as SettledRow[] | null) ?? []).map(toJob);
      },
      countFrom: async (cursor) => {
        const { count } = await settledQuery(w, PROVIDER_OUTCOME_UNKNOWN_CODE, cursor, true);
        return count ?? 0;
      },
      process: processJob,
    });
  const collect = (label: string, r: Awaited<ReturnType<typeof scanSettled>>) => {
    result.refundedJobs += r.outcomes.refunded ?? 0;
    result.errors.push(...r.errors);
    return `${label}: scanned=${r.scanned} ${JSON.stringify(r.outcomes)} left=${r.left}`;
  };
  try {
    const active = await scanSettled(windows.active, (j) => reconcileSettledProviderFailure(settledOps, j));
    result.settledLeft = active.left;
    console.log(`[generation-reconcile] ${collect("settled", active)}`);
    const expired = await scanSettled(windows.expired, (j) =>
      expireSettledJob(settledOps, markSettledJobUnresolved, j),
    );
    result.unresolvedJobs = expired.outcomes.unresolved ?? 0;
    console.log(`[generation-reconcile] ${collect("settled-expired", expired)}`);
  } catch (e) {
    result.errors.push(`settled jobs query: ${e instanceof Error ? e.message : String(e)}`);
  }

  // S2: ambiguous images of partly delivered Fal batches (migration 119), each refunded on its own
  // once Fal confirms THAT prediction failed, or delivered late once Fal confirms it finished.
  // Own budget slice; skipped while the table is absent.
  try {
    if (!(await batchItemsTableReady())) {
      result.itemsScanSkipped = true;
      console.log("[generation-reconcile] items: skipped (generation_batch_items missing)");
    } else {
      const itemOps: BatchItemOps = {
        jobStatus: async (profileId, jobId) => (await getJob(profileId, jobId))?.status ?? null,
        predictionStatus: async (providerId, predictionId) => {
          const provider = getPhotoProviderById(providerId);
          if (!provider?.commitsOnSubmit) return "unknown";
          return (await provider.getPredictionStatus(predictionId)).status;
        },
        refundedAmount: refundedAmountForJob,
        spendAmount: spendAmountForJob,
        refund: refundCredits,
        settle: settleAmbiguousBatchItem,
        markRefund: markBatchItemRefund,
        late: {
          claim: claimBatchItemDelivery,
          outputUrl: async (providerId, predictionId) => {
            const provider = getPhotoProviderById(providerId);
            if (!provider?.getPredictionOutput) throw new Error("Late delivery is not supported for this provider.");
            return provider.getPredictionOutput(predictionId);
          },
          download: async (url) => {
            const res = await fetch(url, { signal: AbortSignal.timeout(SETTLED_CONFIRM_TIMEOUT_MS) });
            if (!res.ok) throw new Error(`Download failed (${res.status}).`);
            return res.arrayBuffer();
          },
          userIdForProfile,
          isStored: async (storagePath) => {
            const { data, error } = await mediaExists(storagePath);
            if (data === null) throw new Error(error?.message ?? "Storage check failed.");
            return data;
          },
          save: ({ poseId, styleId, ...rest }) =>
            saveGeneratedProductPhoto({ ...rest, poseId: poseId as ModelPoseId, styleId: styleId as PhotoStyleId }),
          recordLibrary: async ({ userId, storagePath, poseId, styleId, prompt, title, creationKind, characterName, modelTier, modelLabel, skillId, jobId }) => {
            const str = (v: unknown) => (typeof v === "string" ? v : undefined);
            try {
              await insertProductPhotoGeneration({
                userId,
                imageUrl: storagePath,
                storagePath,
                poseId: poseId as ModelPoseId,
                styleId: styleId as PhotoStyleId,
                prompt: str(prompt),
                title: str(title),
                creationKind: str(creationKind),
                characterName: str(characterName),
                modelTier: str(modelTier),
                modelLabel: str(modelLabel),
                skillId: str(skillId),
                jobId: str(jobId),
              });
            } catch (e) {
              // Unique (user_id, storage_path): the earlier attempt already wrote it.
              if (!/duplicate key|unique constraint/i.test(e instanceof Error ? e.message : String(e))) throw e;
            }
          },
          // markAssetFailed replaced the route's metadata; restore what the stored params carry.
          markReady: (profileId, assetId, storagePath, credits, { poseId, styleId, modelTier, skillId }) =>
            markAssetReady(profileId, assetId, {
              storagePath,
              mimeType: GENERATED_PHOTO_MIME,
              costCredits: credits,
              metadata: { poseId, styleId, modelTier, ...(skillId ? { skillId } : {}), deliveredLate: true },
            }),
          finish: finishBatchItemDelivery,
        },
      };
      const w = { after: windows.expired.after, before: windows.active.before };
      const items = await scanSettledJobs(
        {
          fetchPage: (cursor, limit) => fetchOpenBatchItems(w, cursor, limit),
          countFrom: (cursor) => countOpenBatchItems(w, cursor),
          process: (item) => settleBatchItem(itemOps, item, { expired: Date.parse(item.updatedAt) <= Date.parse(windows.active.after) }),
        },
        { budgetMs: Math.max(0, Math.min(SETTLED_ITEMS_BUDGET_MS, SETTLED_ITEMS_RUN_DEADLINE_MS - (Date.now() - runStart))) },
      );
      result.itemsRefunded = items.outcomes.refunded ?? 0;
      result.itemsDeliveredLate = items.outcomes.delivered_late ?? 0;
      result.itemsUnresolved = items.outcomes.unresolved ?? 0;
      result.itemsLeft = items.left;
      result.errors.push(...items.errors);
      console.log(`[generation-reconcile] items: scanned=${items.scanned} ${JSON.stringify(items.outcomes)} left=${items.left}`);
    }
  } catch (e) {
    result.errors.push(`batch items: ${e instanceof Error ? e.message : String(e)}`);
  }

  const { data: staleRequests, error: reqError } = await supabaseServer
    .from("generation_requests")
    .select("id, job_id, profile_id")
    .eq("status", "started")
    .lt("locked_until", new Date().toISOString())
    .limit(50);

  if (reqError) {
    result.errors.push(`generation_requests query: ${reqError.message}`);
  } else {
    for (const row of (staleRequests as {
      id: string;
      job_id: string | null;
      profile_id: string;
    }[] | null) ?? []) {
      result.staleRequests += 1;
      try {
        if (row.job_id) {
          const job = await getJob(row.profile_id, row.job_id);
          if (job?.status === "queued" || job?.status === "running") {
            continue;
          }
          if (job?.status === "recoverable") {
            await finishGenerationRequestRecoverable({
              id: row.id,
              profileId: row.profile_id,
              jobId: row.job_id,
              errorJson: {
                code: PIPELINE_RECOVERABLE_CODE,
                message:
                  typeof job.error?.message === "string"
                    ? job.error.message
                    : "Generation paused for recovery.",
              },
            });
            continue;
          }
        }
        await finishGenerationRequestFailure({
          id: row.id,
          profileId: row.profile_id,
          jobId: row.job_id,
          errorJson: {
            code: "STALE_GENERATION",
            message: "Generation request expired without finishing.",
          },
        });
      } catch (e) {
        result.errors.push(`request ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return result;
}
