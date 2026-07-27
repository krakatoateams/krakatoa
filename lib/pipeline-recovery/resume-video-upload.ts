import { artifactFetchUrl } from "@/lib/reels-pipeline/recovery-helpers";
import type { JobRecoveryManifest } from "./manifest";
import { RecoverablePipelineError } from "./errors";

export type ResumeVideoUploadResult = {
  storagePath: string;
  publicUrl: string;
};

/** Download resumable replicate video and upload to canonical generated path. */
export async function resumeVideoUploadFromManifest(params: {
  userId: string;
  manifest: JobRecoveryManifest;
  upload: (buffer: ArrayBuffer, filename: string) => Promise<ResumeVideoUploadResult>;
}): Promise<ResumeVideoUploadResult> {
  const sourcePath =
    params.manifest.artifacts.replicateVideoUrl ?? params.manifest.artifacts.veoVideo;
  if (!sourcePath) {
    throw new RecoverablePipelineError("Missing video artifact for resume.", "upload");
  }

  const fetchUrl = await artifactFetchUrl(sourcePath, params.userId);
  const resp = await fetch(fetchUrl);
  if (!resp.ok) {
    throw new RecoverablePipelineError(
      `Failed to download resumable video: ${resp.status} ${resp.statusText}`,
      "upload",
    );
  }

  const buffer = await resp.arrayBuffer();
  return params.upload(buffer, `video_${Date.now()}.mp4`);
}
