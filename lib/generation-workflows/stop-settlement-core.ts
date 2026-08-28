import { getJob } from "@/lib/jobs-db";
import { userIdFromJob } from "@/lib/pipeline-recovery/failure";
import { purgeResumableJobStorage } from "@/lib/pipeline-recovery/storage";
import { supabaseServer } from "@/lib/supabase-server";
import {
  atomicFailWorkflowGeneration,
  atomicSettleGenerationStop,
} from "./workflow-db";
import { deleteStoragePathIfPresent } from "./finalization-db";
import type { StopSettlementParams, StopSettlementResult } from "./stop-settlement-types";

/** Drop artifacts a settled job checkpointed but will never deliver. */
async function purgeSettledJobStorage(
  profileId: string,
  jobId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await supabaseServer
    .from("assets")
    .select("storage_path")
    .eq("profile_id", profileId)
    .eq("job_id", jobId)
    .eq("status", "failed")
    .not("storage_path", "is", null);

  if (error) {
    throw new Error(error.message || "purgeSettledJobStorage read failed");
  }

  const safeUser = userId.replace(/[^a-zA-Z0-9-]/g, "");
  const prefix = `${safeUser}/`;
  const paths = ((data ?? []) as { storage_path?: string }[])
    .map((row) => row.storage_path?.trim() ?? "")
    .filter((path) => path.startsWith(prefix));

  for (const path of paths) {
    await deleteStoragePathIfPresent(path, userId);
  }
}

/** Durable stop settlement — atomic RPC then storage purge (always, including replay). */
export async function settleGenerationStop(
  params: StopSettlementParams,
): Promise<StopSettlementResult> {
  const result = await atomicSettleGenerationStop(params.profileId, params.jobId);

  const job = await getJob(params.profileId, params.jobId);
  if (!job) {
    throw new Error("settleGenerationStop: job not found after settlement RPC");
  }

  if (job.status === "succeeded") {
    return result;
  }

  const userId = userIdFromJob(job, params.userId);
  if (userId) {
    await purgeResumableJobStorage(userId, params.jobId);
    await purgeSettledJobStorage(params.profileId, params.jobId, userId);
  }

  return result;
}

/**
 * Durable failure settlement — atomic RPC, then drop the undelivered artifacts.
 * A stop that raced us wins, so the run settles as a user stop instead.
 */
export async function settleWorkflowFailure(params: {
  profileId: string;
  userId: string;
  jobId: string;
  generationRequestId: string;
  errorJson: Record<string, unknown>;
  refund?: boolean;
}): Promise<void> {
  const outcome = await atomicFailWorkflowGeneration({
    profileId: params.profileId,
    jobId: params.jobId,
    generationRequestId: params.generationRequestId,
    errorJson: params.errorJson,
    refund: params.refund !== false,
  });

  if (outcome.action === "stop_won") {
    await settleGenerationStop({
      profileId: params.profileId,
      userId: params.userId,
      jobId: params.jobId,
    });
    return;
  }

  if (outcome.action === "invalid") {
    throw new Error(outcome.reason ?? "Workflow failure settlement was rejected.");
  }

  // Re-read rather than trust the RPC action: on a replay the job is already failed, and
  // a retry only exists because the first purge did not finish.
  const job = await getJob(params.profileId, params.jobId);
  if (params.userId && job?.status !== "succeeded") {
    await purgeSettledJobStorage(params.profileId, params.jobId, params.userId);
  }
}
