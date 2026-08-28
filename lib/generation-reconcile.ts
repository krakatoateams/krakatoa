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

/** Buffer beyond idempotency lock TTL before treating a run as abandoned. */
const RECONCILE_BUFFER_MS = 5 * 60 * 1000;

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
  const cutoff = new Date(Date.now() - LOCK_TTL_MS - RECONCILE_BUFFER_MS).toISOString();
  const result: GenerationReconcileResult = {
    staleJobs: 0,
    refundedJobs: 0,
    settledWorkflowJobs: 0,
    liveWorkflowJobs: 0,
    staleRequests: 0,
    expiredRecoverable: 0,
    sweptResumableFolders: 0,
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
          if (refundAmount > 0) {
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
