import { markJobRecoverable } from "@/lib/jobs-db";
import { isRecoverablePipelineError } from "./errors";
import type { PipelineRecoveryHandle } from "./handle";

/** After Replicate returns a video URL, copy to resumable storage for resume. */
export async function checkpointRemoteVideo(
  recovery: PipelineRecoveryHandle | undefined,
  remoteUrl: string,
  filename: string,
  pipeline: "video" | "storyboard_video" | "motion_control",
): Promise<void> {
  if (!recovery) return;
  await recovery.setPipeline(pipeline);
  await recovery.copyReplicateVideo(remoteUrl, filename);
  await recovery.setStep("upload");
}

/** Mark recoverable on upload-stage failure when checkpoints exist. */
export async function markRecoverableIfArtifacts(params: {
  error: unknown;
  profileId: string;
  jobId: string;
  recovery?: PipelineRecoveryHandle;
  finalAssetId?: string | null;
  errorJson: Record<string, unknown>;
}): Promise<boolean> {
  const recoverable =
    isRecoverablePipelineError(params.error) ||
    (params.recovery &&
      (params.recovery.getManifest().artifacts.replicateVideoUrl ||
        params.recovery.getManifest().artifacts.veoVideo));
  if (!recoverable || !params.recovery) return false;

  const manifest = params.recovery.getManifest();
  await markJobRecoverable(params.profileId, params.jobId, {
    recovery: manifest as unknown as Record<string, unknown>,
    outputExtra: params.finalAssetId ? { assetId: params.finalAssetId } : undefined,
    error: params.errorJson,
  });
  return true;
}
