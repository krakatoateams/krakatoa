import { signStoragePathForPipeline } from "@/lib/storage-signed-url";
import type { PipelineRecoveryHandle } from "@/lib/pipeline-recovery/handle";
import { RecoverablePipelineError } from "@/lib/pipeline-recovery/errors";

/** Resolve storage path or remote URL to a fetchable URL for Rendi/Replicate. */
export async function artifactFetchUrl(
  pathOrUrl: string,
  userId: string,
): Promise<string> {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  return signStoragePathForPipeline(pathOrUrl, userId);
}

export async function resolveSceneUrls(
  scenePaths: string[],
  userId: string,
): Promise<string[]> {
  const out: string[] = [];
  for (const p of scenePaths) {
    out.push(await artifactFetchUrl(p, userId));
  }
  return out;
}

/** Throw recoverable when expensive checkpoints exist. */
export function throwRecoverableIfCheckpointed(
  recovery: PipelineRecoveryHandle | undefined,
  step: string,
  error: unknown,
): void {
  if (!recovery) return;
  const m = recovery.getManifest();
  const hasScenes = (m.artifacts.scenes?.length ?? 0) > 0;
  const hasAudio = Boolean(m.artifacts.audio);
  const hasVideo = Boolean(m.artifacts.replicateVideoUrl || m.artifacts.veoVideo);
  if (!hasScenes && !hasAudio && !hasVideo) return;
  const message = error instanceof Error ? error.message : String(error);
  throw new RecoverablePipelineError(message, step);
}
