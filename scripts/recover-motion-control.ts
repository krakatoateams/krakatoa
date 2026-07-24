/**
 * One-off recovery for motion-control jobs where Replicate succeeded but the
 * route timed out before storage upload. Usage:
 *   set -a && source .env.local && set +a && npx tsx scripts/recover-motion-control.ts <idempotency-key>
 */
import { createReplicateClient } from "../lib/replicate-utils";
import { extractMediaUrl } from "../lib/replicate-server";
import { supabaseServer } from "../lib/supabase-server";
import { listPredictionIds } from "../lib/generation-cancel";
import {
  buildMotionControlFinalizeContext,
  type MotionControlJobInput,
} from "../lib/motion-control-context";
import { finalizeMotionControlSuccess } from "../lib/motion-control-finalize";
import type { Job } from "../lib/jobs-db";

async function main() {
  const idempotencyKey = process.argv[2];
  if (!idempotencyKey) {
    console.error("Usage: npx tsx scripts/recover-motion-control.ts <idempotency-key>");
    process.exit(1);
  }

  const { data: generationRequest, error } = await supabaseServer
    .from("generation_requests")
    .select("*")
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (error || !generationRequest) {
    throw new Error(error?.message ?? "Generation request not found");
  }
  if (generationRequest.status === "succeeded" && generationRequest.response_json) {
    console.log("Already succeeded:", generationRequest.response_json);
    return;
  }

  const profileId = generationRequest.profile_id as string;
  const { data: profile } = await supabaseServer
    .from("profiles")
    .select("user_id")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile?.user_id) throw new Error("Profile not found");

  const predictionIds = await listPredictionIds(profileId, generationRequest.id);
  if (!predictionIds.length) throw new Error("No predictions recorded");

  const replicate = createReplicateClient();
  const prediction = await replicate.predictions.get(predictionIds[predictionIds.length - 1]!);
  if (prediction.status !== "succeeded") {
    throw new Error(`Prediction status is ${prediction.status}, not succeeded`);
  }

  const generatedVideoUrl = extractMediaUrl(prediction.output);
  if (!generatedVideoUrl.startsWith("http")) {
    throw new Error("Invalid video URL from prediction output");
  }

  const jobId =
    generationRequest.job_id ??
    (
      await supabaseServer
        .from("generation_predictions")
        .select("job_id")
        .eq("generation_request_id", generationRequest.id)
        .not("job_id", "is", null)
        .limit(1)
        .maybeSingle()
    ).data?.job_id ??
    null;

  const { data: jobRow } = jobId
    ? await supabaseServer.from("jobs").select("*").eq("id", jobId).maybeSingle()
    : { data: null };
  const job = (jobRow as Job | null) ?? null;
  const jobInput = (job?.input ?? {}) as MotionControlJobInput;

  const ctx = buildMotionControlFinalizeContext({
    profileId,
    userId: profile.user_id,
    jobId,
    videoAssetId: generationRequest.asset_id ?? jobInput.videoAssetId ?? null,
    generationRequestId: generationRequest.id,
    creditsAmount: jobInput.creditsAmount ?? job?.cost_credits ?? 0,
    prompt: jobInput.prompt ?? "",
    jobInput,
  });

  const result = await finalizeMotionControlSuccess(ctx, generatedVideoUrl);
  console.log("Recovered:", result.storagePath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
