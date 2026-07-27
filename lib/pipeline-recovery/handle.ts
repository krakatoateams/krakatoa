import {
  getJob,
  updateJobRecoveryOutput,
  type Job,
} from "@/lib/jobs-db";
import {
  type JobRecoveryManifest,
  type RecoveryStep,
  emptyManifest,
  mergeManifest,
  parseRecoveryManifest,
  defaultExpiresAt,
} from "./manifest";
import { copyUrlToResumable, uploadToResumable } from "./storage";
import { userResumablePrefix } from "@/lib/storage-buckets";

export type PipelineRecoveryHandle = {
  jobId: string;
  profileId: string;
  userId: string;
  getManifest: () => JobRecoveryManifest;
  setStep: (step: RecoveryStep) => Promise<void>;
  copySceneFromUrl: (index: number, url: string) => Promise<string>;
  copyAudioFromUrl: (url: string) => Promise<string>;
  uploadCaptions: (assContent: string) => Promise<string>;
  copyReplicateVideo: (url: string, filename: string) => Promise<string>;
  setRendiParams: (params: JobRecoveryManifest["rendiParams"]) => Promise<void>;
  setPipeline: (pipeline: JobRecoveryManifest["pipeline"]) => Promise<void>;
  bumpSceneRetry: (index: number) => number;
};

/** Create a recovery handle bound to a job; initializes manifest on first use. */
export function createPipelineRecoveryHandle(params: {
  profileId: string;
  userId: string;
  jobId: string;
  existingJob?: Job | null;
}): PipelineRecoveryHandle {
  const storagePrefix = userResumablePrefix(params.userId, params.jobId);
  let manifest =
    parseRecoveryManifest(params.existingJob?.output) ??
    emptyManifest(storagePrefix);

  const persist = async (patch: Partial<JobRecoveryManifest>): Promise<void> => {
    manifest = mergeManifest(manifest, {
      ...patch,
      expiresAt: defaultExpiresAt(),
    });
    await updateJobRecoveryOutput(params.profileId, params.jobId, manifest as unknown as Record<string, unknown>);
  };

  return {
    jobId: params.jobId,
    profileId: params.profileId,
    userId: params.userId,
    getManifest: () => manifest,
    setStep: async (step) => persist({ step }),
    copySceneFromUrl: async (index, url) => {
      const path = await copyUrlToResumable(
        params.userId,
        params.jobId,
        `scenes/scene_${index}.mp4`,
        url,
        "video/mp4",
      );
      const scenes = [...(manifest.artifacts.scenes ?? [])];
      scenes[index] = path;
      await persist({ step: "scenes", artifacts: { scenes } });
      return path;
    },
    copyAudioFromUrl: async (url) => {
      const path = await copyUrlToResumable(
        params.userId,
        params.jobId,
        "audio/tts.mp3",
        url,
        "audio/mpeg",
      );
      await persist({ step: "tts", artifacts: { audio: path } });
      return path;
    },
    uploadCaptions: async (assContent) => {
      const path = await uploadToResumable(
        params.userId,
        params.jobId,
        "captions.ass",
        assContent,
        "text/plain",
      );
      await persist({ artifacts: { captions: path } });
      return path;
    },
    copyReplicateVideo: async (url, filename) => {
      const path = await copyUrlToResumable(
        params.userId,
        params.jobId,
        filename,
        url,
        "video/mp4",
      );
      await persist({ artifacts: { replicateVideoUrl: path, veoVideo: path } });
      return path;
    },
    setRendiParams: async (rendiParams) => persist({ rendiParams }),
    setPipeline: async (pipeline) => persist({ pipeline }),
    bumpSceneRetry: (index) => {
      const key = String(index);
      const count = (manifest.sceneRetries[key] ?? 0) + 1;
      manifest.sceneRetries[key] = count;
      return count;
    },
  };
}

export async function loadJobRecovery(
  profileId: string,
  jobId: string,
): Promise<{ job: Job; manifest: JobRecoveryManifest } | null> {
  const job = await getJob(profileId, jobId);
  if (!job) return null;
  const manifest = parseRecoveryManifest(job.output);
  if (!manifest) return null;
  return { job, manifest };
}
