/** Recovery checkpoint steps for video generation pipelines. */
export type RecoveryStep = "llm" | "tts" | "scenes" | "rendi" | "upload" | "done";

export type JobRecoveryManifest = {
  storagePrefix: string;
  step: RecoveryStep;
  pipeline?: "reels_seedance" | "reels_veo_single" | "reels_veo_per_scene" | "video" | "storyboard_video" | "motion_control";
  artifacts: {
    scenes?: string[];
    audio?: string;
    captions?: string;
    replicateVideoUrl?: string;
    veoVideo?: string;
  };
  rendiRetries: number;
  sceneRetries: Record<string, number>;
  expiresAt: string;
  rendiParams?: {
    targetW: number;
    targetH: number;
    perSceneDurStr?: string;
    audioSpeedFactor: number;
    finalDuration: number;
    shortest?: boolean;
    fontname?: string;
  };
  resumeAttempts?: number;
  lastError?: { code: string; message: string };
};

export const DEFAULT_RECOVERY_TTL_MS = 24 * 60 * 60 * 1000;
export const MAX_RESUME_ATTEMPTS = 5;

export function defaultExpiresAt(fromMs = Date.now()): string {
  return new Date(fromMs + DEFAULT_RECOVERY_TTL_MS).toISOString();
}

export function emptyManifest(storagePrefix: string): JobRecoveryManifest {
  return {
    storagePrefix,
    step: "llm",
    artifacts: {},
    rendiRetries: 0,
    sceneRetries: {},
    expiresAt: defaultExpiresAt(),
    resumeAttempts: 0,
  };
}

export function mergeManifest(
  base: JobRecoveryManifest,
  patch: Partial<JobRecoveryManifest>,
): JobRecoveryManifest {
  return {
    ...base,
    ...patch,
    artifacts: { ...base.artifacts, ...patch.artifacts },
    sceneRetries: { ...base.sceneRetries, ...patch.sceneRetries },
    rendiParams: patch.rendiParams
      ? { ...base.rendiParams, ...patch.rendiParams }
      : base.rendiParams,
    lastError: patch.lastError ?? base.lastError,
  };
}

export function parseRecoveryManifest(
  output: Record<string, unknown> | null | undefined,
): JobRecoveryManifest | null {
  const raw = output?.recovery;
  if (!raw || typeof raw !== "object") return null;
  const m = raw as JobRecoveryManifest;
  if (!m.storagePrefix || !m.step || !m.expiresAt) return null;
  return m;
}
