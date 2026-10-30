/** Provider seam used only by the generate-photo path (phase 2 of the multi-provider rollout). */
export type PhotoPredictionTick = { id: string; status: string };

export type PhotoRunHooks = {
  /** Cheap, non-throwing; records the prediction id so a separate cancel request can stop it. */
  onPrediction?: (tick: PhotoPredictionTick) => void;
  /** Polled on each wait tick; throw `GenerationCancelledError` to abort the run. */
  abortCheck?: () => Promise<void>;
};

export type PhotoPredictionStatus = { id: string; status: string; error?: string };

export interface PhotoProvider {
  readonly id: "replicate" | "fal";
  /** True when a cancel is only a request (the run may still finish and bill): the route locks cancel at submit. */
  readonly commitsOnSubmit: boolean;
  /** Upload a user reference image so the model can fetch it; returns a provider-readable URL. */
  uploadReference(file: File): Promise<string>;
  /** Create + wait (with 429 backoff, abort check, prediction hooks); returns the media URL. */
  run(args: {
    model: string;
    input: Record<string, unknown>;
    hooks?: PhotoRunHooks;
    maxRetries?: number;
  }): Promise<string>;
  /** Best-effort cancel; never throws. */
  cancelPredictions(ids: string[]): Promise<{ requested: number; cancelled: number }>;
  /** Read the current status of one prediction. */
  getPredictionStatus(id: string): Promise<PhotoPredictionStatus>;
}
