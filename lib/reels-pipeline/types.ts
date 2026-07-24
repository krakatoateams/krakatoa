/**
 * Shared types for the unified Reels Creator pipeline.
 *
 * The HTTP route (`app/api/generate-reels/route.ts`) owns profile resolution,
 * idempotency, the credit spend/refund contract, job/asset lifecycle, and usage
 * events. Each engine pipeline function below receives a ready-to-use context
 * (resolved models, a step logger, a cancellation probe, and a prediction
 * recorder) and returns the finished video plus the metadata the route needs to
 * finalize the asset, job, usage event, and history row.
 */
import type Replicate from "replicate";
import type { ReplicateModelRef, ResolvedModel } from "@/lib/model-resolver";
import type { ReplicateRunHooks } from "@/lib/replicate-server";

export type ReelsEngine = "seedance" | "veo";
export type ReelsVeoMode = "single" | "perScene";

export type CaptionStyle = {
  fontname: string;
  fontsize: number;
  primaryColor: string;
  highlightColor: string;
  outlineColor: string;
  outlineThickness: number;
  marginV: number;
  highlightOnly?: boolean;
};

export type WordChunk = { text: string; start: number; end: number };

/** The four Replicate roles every reels pipeline resolves from model_configs. */
export type ReelsModelSet = {
  llm: ResolvedModel;
  video: ResolvedModel;
  tts: ResolvedModel;
  whisper: ResolvedModel;
};

/** The same four roles as `${owner}/${name}[:version]` Replicate refs. */
export type ReelsModelRefs = {
  llmRef: ReplicateModelRef;
  videoRef: ReplicateModelRef;
  ttsRef: ReplicateModelRef;
  whisperRef: ReplicateModelRef;
};

/** Best-effort job_steps diary, wired by the route. Never throws. */
export type StepLogger = {
  beginStep: (
    stepKey: string,
    stepName: string,
    input?: Record<string, unknown>
  ) => Promise<void>;
  endStep: (output?: Record<string, unknown>) => Promise<void>;
};

export type ReelsPipelineContext = {
  replicate: Replicate;
  /** NextAuth users.id — scopes Supabase Storage under `videos/{userId}/`. */
  userId: string;
  /** Validated up front by the route so the pipeline can fail fast on misconfig. */
  rendiApiKey: string;
  models: ReelsModelSet;
  refs: ReelsModelRefs;
  log: StepLogger;
  /** Polled between steps to abort early on a user cancellation. */
  isCancelled: () => Promise<boolean>;
  /** Records every Replicate prediction id so a separate cancel request can stop it. */
  recorder: ReplicateRunHooks;
};

export type ReelsPipelineResult = {
  videoUrl: string;
  storagePath: string;
  width: number;
  height: number;
  durationSec: number;
  /** Continuous narration text (TTS script, or the transcript for Veo single). */
  narration: string;
  /** Per-scene visual prompts (or the single Veo prompt) for history metadata. */
  scenePrompts: string[];
};

export type SeedancePipelineParams = {
  theme: string;
  sceneCount: number;
  durationPerScene: number;
  resolution: "480p" | "720p";
  voiceId: string;
  /** User emotion; "auto" defers to the LLM-suggested narrator emotion. */
  emotion: string;
  style: CaptionStyle;
};

export type VeoSinglePipelineParams = {
  theme: string;
  duration: number;
  resolution: "720p" | "1080p";
  voiceId: string;
  /** Resolved MiniMax emotion (the route maps "auto"/invalid to "neutral"). */
  emotion: string;
  singlePromptScenes: number;
  style: CaptionStyle;
};

export type VeoPerScenePipelineParams = {
  theme: string;
  duration: number;
  resolution: "720p" | "1080p";
  voiceId: string;
  emotion: string;
  sceneCount: number;
  style: CaptionStyle;
};
