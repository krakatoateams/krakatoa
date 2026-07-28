import {
  concatScenes,
  mergeVideoAudioSubs,
  burnSubtitles,
  getFontUrl,
} from "@/lib/reels-pipeline/rendi-stitch";
import {
  downloadAndStoreFinal,
} from "@/lib/reels-pipeline/storage";
import {
  artifactFetchUrl,
  resolveSceneUrls,
} from "@/lib/reels-pipeline/recovery-helpers";
import type { JobRecoveryManifest } from "./manifest";
import { MAX_RESUME_ATTEMPTS } from "./manifest";
import { RecoverablePipelineError } from "./errors";

export type ResumeReelsResult = {
  videoUrl: string;
  storagePath: string;
  width: number;
  height: number;
  durationSec: number;
};

/** Continue reels pipeline from Rendi/upload using resumable artifacts. */
export async function resumeReelsFromManifest(params: {
  userId: string;
  manifest: JobRecoveryManifest;
}): Promise<ResumeReelsResult> {
  const { userId, manifest } = params;
  const attempts = manifest.resumeAttempts ?? 0;
  if (attempts >= MAX_RESUME_ATTEMPTS) {
    throw new Error("Maximum resume attempts exceeded.");
  }

  const rendiParams = manifest.rendiParams;
  if (!rendiParams) {
    throw new RecoverablePipelineError("Missing rendi parameters in recovery manifest.", "rendi");
  }

  const scenes = manifest.artifacts.scenes ?? [];
  const captions = manifest.artifacts.captions;
  if (!captions) {
    throw new RecoverablePipelineError("Missing caption artifact for resume.", "rendi");
  }

  const srtUrl = await artifactFetchUrl(captions, userId);
  const targetW = rendiParams.targetW;
  const targetH = rendiParams.targetH;
  const finalDuration = rendiParams.finalDuration;
  const audioSpeedFactor = rendiParams.audioSpeedFactor;
  const perSceneDurStr = rendiParams.perSceneDurStr ?? String(finalDuration);

  let rendiVideoUrl: string;

  if (manifest.pipeline === "reels_veo_single") {
    const veoPath = manifest.artifacts.veoVideo ?? manifest.artifacts.replicateVideoUrl;
    if (!veoPath) {
      throw new RecoverablePipelineError("Missing Veo video artifact for resume.", "rendi");
    }
    const burnInput = await artifactFetchUrl(veoPath, userId);
    rendiVideoUrl = await burnSubtitles(burnInput, srtUrl);
  } else {
    if (scenes.length === 0) {
      throw new RecoverablePipelineError("Missing scene artifacts for resume.", "rendi");
    }
    const sceneUrls = await resolveSceneUrls(scenes, userId);
    const combinedVideoUrl = await concatScenes(
      sceneUrls,
      perSceneDurStr,
      targetW,
      targetH,
    );
    const audioPath = manifest.artifacts.audio;
    if (!audioPath) {
      throw new RecoverablePipelineError("Missing audio artifact for resume.", "rendi");
    }
    const fullAudioUrl = await artifactFetchUrl(audioPath, userId);
    const fontUrl = rendiParams.fontname ? getFontUrl(rendiParams.fontname) : undefined;
    const mergedVideoUrl = await mergeVideoAudioSubs({
      combinedVideoUrl,
      fullAudioUrl,
      srtUrl,
      fontUrl,
      audioSpeedFactor,
      finalDuration,
      shortest: rendiParams.shortest ?? false,
    });
    rendiVideoUrl = await burnSubtitles(mergedVideoUrl, srtUrl);
  }

  const { storagePath, publicUrl } = await downloadAndStoreFinal(
    userId,
    "reelscreator",
    rendiVideoUrl,
    `video_${Date.now()}.mp4`,
  );

  return {
    videoUrl: publicUrl,
    storagePath,
    width: targetW,
    height: targetH,
    durationSec: finalDuration,
  };
}
