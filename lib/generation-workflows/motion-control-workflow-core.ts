import { createReplicateClient } from "@/lib/replicate-utils";
import { recordPrediction } from "@/lib/generation-cancel";
import { createJobStep, finishJobStep, failJobStep } from "@/lib/job-steps-db";
import {
  cleanupMotionControlTempRefs,
  type MotionControlSuccessResponse,
} from "@/lib/motion-control-finalize";
import { CREATION_TOOLS } from "@/lib/creations";
import {
  getMotionControlModel,
  motionControlResolutionLabel,
} from "@/lib/motion-control-models";
import { recordUsageEvent } from "@/lib/usage-events-db";
import { signStoragePathForUser } from "@/lib/storage-signed-url";
import { MEDIA_CACHE_CONTROL, STORAGE_BUCKET } from "@/lib/storage-buckets";
import { supabaseServer } from "@/lib/supabase-server";
import { assertTrustedReplicateOutputUrl } from "@/lib/replicate-output-url";
import {
  classifyProviderSubmitError,
  type SubmitPredictionStepResult,
} from "./submission-fence-pure";
import {
  collectRecentPredictions,
  findUniquePredictionByWebhook,
  unknownSubmissionTimeoutErrorJson,
  type PredictionListPage,
} from "./submission-recovery-pure";
import {
  claimProviderSubmission,
  markProviderSubmissionSubmitted,
  completeProviderSubmission,
  completeWorkflowProviderSuccess,
  getProviderSubmission,
  markProviderSubmissionUnknownTimeout,
} from "./submission-fence-db";
import {
  isWorkflowStopRequested,
  touchJobHeartbeat,
} from "./workflow-db";
import { resolvePollTerminalDecision } from "./polling-pure";
import {
  atomicFinalizeWorkflowSuccess,
  checkpointProcessingAssetPath,
  deleteStoragePathIfPresent,
} from "./finalization-db";
import { replicateWebhookCallbackUrl } from "./replicate-webhook";
import { signWebhookCallbackToken, webhookCallbackSecret } from "./webhook-token-pure";
import {
  MOTION_CONTROL_SUBMISSION_SLOT,
  motionControlWorkflowStoragePath,
  workflowStoppedMessage,
  type MotionControlWorkflowParams,
} from "./motion-control-workflow-types";

export async function beginMotionControlStepCore(
  params: MotionControlWorkflowParams,
): Promise<string | null> {
  await touchJobHeartbeat(params.profileId, params.jobId);

  const { data: existing } = await supabaseServer
    .from("job_steps")
    .select("id")
    .eq("job_id", params.jobId)
    .eq("profile_id", params.profileId)
    .eq("step_key", "motion_control_generation")
    .eq("status", "running")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing && typeof (existing as { id?: string }).id === "string") {
    return (existing as { id: string }).id;
  }

  const row = await createJobStep({
    jobId: params.jobId,
    profileId: params.profileId,
    stepKey: "motion_control_generation",
    stepName: params.stepLabel,
    status: "running",
    input: {
      mode: params.mode,
      characterOrientation: params.characterOrientation,
      keepOriginalSound: params.keepOriginalSound,
      billedDuration: params.billedDuration,
    },
  });
  return row?.id ?? null;
}

export async function endMotionControlStepCore(
  profileId: string,
  stepId: string | null,
  output?: Record<string, unknown>,
): Promise<void> {
  if (!stepId) return;
  await finishJobStep(profileId, stepId, output);
}

export async function failMotionControlStepCore(
  params: MotionControlWorkflowParams,
  stepId: string | null,
  errJson: Record<string, unknown>,
): Promise<void> {
  if (!stepId) return;
  await failJobStep(params.profileId, stepId, errJson);
}

export async function reserveSubmissionCore(params: MotionControlWorkflowParams) {
  const { reserveProviderSubmission } = await import("./submission-fence-db");
  return reserveProviderSubmission({
    profileId: params.profileId,
    jobId: params.jobId,
    generationRequestId: params.generationRequestId,
    slotKey: MOTION_CONTROL_SUBMISSION_SLOT,
  });
}

export async function loadSubmissionSnapshotCore(
  params: MotionControlWorkflowParams,
  submissionId: string,
) {
  return getProviderSubmission({ profileId: params.profileId, submissionId });
}

export async function markSubmissionUnknownTimeoutCore(
  params: MotionControlWorkflowParams,
  submissionId: string,
): Promise<string | null> {
  const outcome = await markProviderSubmissionUnknownTimeout({
    profileId: params.profileId,
    jobId: params.jobId,
    generationRequestId: params.generationRequestId,
    submissionId,
    errorJson: unknownSubmissionTimeoutErrorJson(),
  });
  if (outcome.action === "stop_won") throw new Error(workflowStoppedMessage());
  if (outcome.action === "timed_out") return null;
  if (outcome.action === "concurrent_terminal" && outcome.predictionId) {
    return outcome.predictionId;
  }
  throw new Error(
    outcome.action === "concurrent_terminal" &&
      typeof outcome.errorJson?.message === "string"
      ? outcome.errorJson.message
      : "Provider submission failed while resolving its timeout.",
  );
}

export async function recoverPredictionFromListCore(
  params: MotionControlWorkflowParams,
  submissionId: string,
): Promise<string | null> {
  const replicate = createReplicateClient();
  const token = signWebhookCallbackToken(submissionId, webhookCallbackSecret());
  const expectedWebhook = replicateWebhookCallbackUrl(submissionId, token);

  const recentPredictions = await collectRecentPredictions(async (cursor) => {
    if (!cursor) return replicate.predictions.list();
    const response = await replicate.request(cursor, { method: "GET" });
    return (await response.json()) as PredictionListPage;
  });

  const predictionId = findUniquePredictionByWebhook(
    recentPredictions,
    expectedWebhook,
  );
  if (!predictionId) return null;
  const marked = await markProviderSubmissionSubmitted({
    profileId: params.profileId,
    submissionId,
    predictionId,
  });
  if (!marked) return null;

  await recordPrediction({
    generationRequestId: params.generationRequestId,
    profileId: params.profileId,
    predictionId,
    jobId: params.jobId,
    kind: "video_motion_control",
    status: "starting",
  });

  return predictionId;
}

export async function submitNewPredictionCore(
  params: MotionControlWorkflowParams,
  submissionId: string,
): Promise<SubmitPredictionStepResult> {
  const claim = await claimProviderSubmission({
    profileId: params.profileId,
    submissionId,
  });

  if (!claim.claimed) {
    if (claim.predictionId) {
      return { outcome: "prediction", predictionId: claim.predictionId };
    }
    return { outcome: "wait" };
  }

  const replicate = createReplicateClient();
  const token = signWebhookCallbackToken(submissionId, webhookCallbackSecret());
  const webhook = replicateWebhookCallbackUrl(submissionId, token);

  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      const prediction = await replicate.predictions.create({
        model: params.modelRef as `${string}/${string}`,
        input: params.providerInput,
        webhook,
        webhook_events_filter: ["completed"],
      });
      if (!prediction?.id) throw new Error("Replicate did not return a prediction id.");

      const bound = await markProviderSubmissionSubmitted({
        profileId: params.profileId,
        submissionId,
        predictionId: prediction.id,
      });
      // Fence already carries another prediction: never poll a run the fence does not own.
      if (!bound) return { outcome: "wait" };

      await recordPrediction({
        generationRequestId: params.generationRequestId,
        profileId: params.profileId,
        predictionId: prediction.id,
        jobId: params.jobId,
        kind: "video_motion_control",
        status: prediction.status ?? "starting",
      });

      return { outcome: "prediction", predictionId: prediction.id };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const kind = classifyProviderSubmitError(message);
      if (kind === "rate_limit" && attempt < 9) {
        let delayMs = 15000;
        const match = message.match(/"retry_after":\s*(\d+)/);
        if (match?.[1]) delayMs = (parseInt(match[1], 10) + 2) * 1000;
        await new Promise((res) => setTimeout(res, delayMs));
        continue;
      }
      if (kind === "definite") {
        await completeProviderSubmission({
          profileId: params.profileId,
          submissionId,
          terminalState: "failed",
          errorJson: { message },
        });
        throw error;
      }
      // Ambiguous/network after claim: stay in submitting and let webhook/poll recover.
      return { outcome: "wait" };
    }
  }

  return { outcome: "wait" };
}

export async function isWorkflowStopRequestedCore(
  params: MotionControlWorkflowParams,
): Promise<boolean> {
  return isWorkflowStopRequested(params.profileId, params.generationRequestId);
}

export async function pollReplicateOnceCore(
  params: MotionControlWorkflowParams,
  submissionId: string,
  predictionId: string,
) {
  const replicate = createReplicateClient();
  const prediction = await replicate.predictions.get(predictionId);
  await recordPrediction({
    generationRequestId: params.generationRequestId,
    profileId: params.profileId,
    predictionId,
    jobId: params.jobId,
    kind: "video_motion_control",
    status: prediction.status,
  });
  const decision = resolvePollTerminalDecision({
    status: prediction.status,
    output: prediction.output,
    error: prediction.error,
  });
  if (!decision.terminal) return decision;

  if (decision.outcome === "success") {
    const commit = await completeWorkflowProviderSuccess({
      profileId: params.profileId,
      jobId: params.jobId,
      generationRequestId: params.generationRequestId,
      submissionId,
      predictionId,
    });
    if (!commit.committed) {
      throw new Error(commit.reason ?? "Failed to commit provider success.");
    }
    if (!commit.shouldContinue) {
      return {
        terminal: true as const,
        outcome: "cancelled" as const,
        message: workflowStoppedMessage(),
      };
    }
    return decision;
  }

  await completeProviderSubmission({
    profileId: params.profileId,
    submissionId,
    predictionId,
    terminalState: "failed",
    errorJson: { message: decision.message },
  });
  return decision;
}

export async function touchHeartbeatCore(params: MotionControlWorkflowParams): Promise<void> {
  await touchJobHeartbeat(params.profileId, params.jobId);
}

export async function deliverAndFinalizeCore(
  params: MotionControlWorkflowParams,
  generatedVideoUrl: string,
): Promise<MotionControlSuccessResponse> {
  const model = getMotionControlModel(params.modelId);
  const resolutionLabel = motionControlResolutionLabel(params.mode);
  const creationMetadata = {
    prompt: params.prompt,
    modelId: params.modelId,
    modelLabel: model.modelLabel,
    providerModel: params.providerModel,
    mode: params.mode,
    resolution: resolutionLabel,
    characterOrientation: params.characterOrientation,
    keepOriginalSound: params.keepOriginalSound,
    billedDuration: params.billedDuration,
    pricingKey: params.pricingKey,
  };

  const storagePath = motionControlWorkflowStoragePath(params.userId, params.jobId);
  assertTrustedReplicateOutputUrl(generatedVideoUrl);
  const videoResponse = await fetch(generatedVideoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Failed to download generated video: ${videoResponse.statusText}`);
  }
  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

  const { error: uploadError } = await supabaseServer.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, videoBuffer, {
      contentType: "video/mp4",
      cacheControl: MEDIA_CACHE_CONTROL,
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`Failed to save video to storage: ${uploadError.message}`);
  }

  if (params.videoAssetId) {
    await checkpointProcessingAssetPath({
      profileId: params.profileId,
      assetId: params.videoAssetId,
      storagePath,
    });
  }

  const { url: publicUrl } = await signStoragePathForUser(storagePath, params.userId, "ui");
  const title = params.prompt.slice(0, 60) || "Motion Control";
  const toolLabel = CREATION_TOOLS.video_motion_control.label;

  const finalizeResult = await atomicFinalizeWorkflowSuccess({
    profileId: params.profileId,
    jobId: params.jobId,
    generationRequestId: params.generationRequestId,
    userId: params.userId,
    storagePath,
    assetId: params.videoAssetId,
    videoUrl: publicUrl,
    jobOutput: {
      videoUrl: publicUrl,
      storagePath,
      assetId: params.videoAssetId,
    },
    costCredits: params.creditsAmount,
    assetMetadata: creationMetadata,
    creationTool: "video_motion_control",
    creationToolLabel: toolLabel,
    creationTitle: title,
    creationMetadata,
  });

  if (finalizeResult.action === "stop_won") {
    await deleteStoragePathIfPresent(storagePath, params.userId);
    throw new Error(workflowStoppedMessage());
  }

  if (finalizeResult.action === "noop_already") {
    const { data, error } = await supabaseServer
      .from("generation_requests")
      .select("response_json, error_json, cancel_requested")
      .eq("id", params.generationRequestId)
      .eq("profile_id", params.profileId)
      .maybeSingle();
    if (error) throw new Error(`Failed to read terminal workflow result: ${error.message}`);
    const terminal = data as {
      response_json?: MotionControlSuccessResponse | null;
      error_json?: { message?: string; code?: string } | null;
      cancel_requested?: boolean;
    } | null;
    const replay = terminal?.response_json;
    if (replay) return replay;
    if (
      terminal?.cancel_requested ||
      terminal?.error_json?.code === "GENERATION_CANCELLED"
    ) {
      await deleteStoragePathIfPresent(storagePath, params.userId);
      throw new Error(workflowStoppedMessage());
    }
    throw new Error(terminal?.error_json?.message ?? "Workflow already ended without a result.");
  }

  if (finalizeResult.action !== "finalized") {
    throw new Error(finalizeResult.reason ?? "Workflow finalization failed.");
  }

  try {
    await recordUsageEvent({
      profileId: params.profileId,
      jobId: params.jobId,
      assetId: params.videoAssetId,
      tool: "reels",
      provider: params.provider,
      model: params.providerModel,
      unitType: "video_seconds",
      units: params.billedDuration,
      creditsCharged: params.creditsAmount,
      metadata: {
        jobType: "video_motion_control",
        modelId: params.modelId,
        mode: params.mode,
        pricingKey: params.pricingKey,
      },
    });
  } catch (error) {
    console.warn("[motion-control workflow] usage event failed:", error);
  }

  if (finalizeResult.responseJson) {
    return finalizeResult.responseJson as MotionControlSuccessResponse;
  }

  return {
    videoUrl: publicUrl,
    storagePath,
    historyItem: null,
    savedToCloud: true,
  };
}

export async function cleanupTempRefsCore(paths: string[]): Promise<void> {
  await cleanupMotionControlTempRefs(paths);
}
