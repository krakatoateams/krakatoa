import type { MotionControlFinalizeContext } from "@/lib/motion-control-finalize";
import type { MotionControlMode, CharacterOrientation } from "@/lib/motion-control-models";

/** Persisted on jobs.input so the status route can finalize after a long Replicate run. */
export type MotionControlJobInput = {
  modelId: string;
  mode: MotionControlMode;
  characterOrientation: CharacterOrientation;
  keepOriginalSound: boolean;
  billedDuration: number;
  pricingKey: string;
  prompt?: string;
  provider?: string;
  providerModel?: string;
  creditsAmount?: number;
  tempRefPaths?: string[];
  generationRequestId?: string;
  videoAssetId?: string;
};

export function buildMotionControlFinalizeContext(params: {
  profileId: string;
  userId: string;
  jobId: string | null;
  videoAssetId: string | null;
  generationRequestId: string | null;
  creditsAmount: number;
  prompt: string;
  jobInput: MotionControlJobInput;
}): MotionControlFinalizeContext {
  const input = params.jobInput;
  return {
    profileId: params.profileId,
    userId: params.userId,
    jobId: params.jobId,
    videoAssetId: params.videoAssetId,
    generationRequestId: params.generationRequestId,
    creditsAmount: params.creditsAmount,
    prompt: input.prompt ?? params.prompt,
    modelId: input.modelId,
    mode: input.mode,
    characterOrientation: input.characterOrientation,
    keepOriginalSound: input.keepOriginalSound,
    billedDuration: input.billedDuration,
    pricingKey: input.pricingKey,
    provider: input.provider ?? "replicate",
    providerModel: input.providerModel ?? "",
    tempRefPaths: input.tempRefPaths,
  };
}
