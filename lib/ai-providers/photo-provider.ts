/** Provider seam used only by the generate-photo path (phase 2 of the multi-provider rollout). */
export type PhotoPredictionTick = { id: string; status: string };

export type PhotoRunHooks = {
  /** Cheap, non-throwing; records the prediction id so a separate cancel request can stop it. */
  onPrediction?: (tick: PhotoPredictionTick) => void;
  /** Polled on each wait tick; throw `GenerationCancelledError` to abort the run. */
  abortCheck?: () => Promise<void>;
  /**
   * `cancelWhileQueued` providers only. Locks cancel at request level (batch: one lock). With
   * `ifNoCancel` it is a compare-and-set that resolves false, without locking, when a user cancel is
   * in flight; without it the attempt is committed unconditionally. Resolves true when locked.
   */
  commit?: (opts: { ifNoCancel: boolean }) => Promise<boolean>;
  /** Trace of one provider cancel attempt (non-throwing). */
  onCancelAttempt?: (attempt: { result: string; confirmed: boolean; status: string }) => void;
};

export type PhotoPredictionStatus = { id: string; status: string; error?: string };

export interface PhotoProvider {
  readonly id: "replicate" | "fal";
  /**
   * Settlement policy: true when a failure after submit is ambiguous (the run may still finish and
   * bill), so only a definitive provider failure refunds (`shouldRefundFailedBatchImage`, reconcile).
   * It does NOT decide when cancel locks; see `cancelWhileQueued`.
   */
  readonly commitsOnSubmit: boolean;
  /**
   * True when the provider can really cancel a request that is still queued and confirms it (Fal).
   * The adapter then owns cancel + confirmation and locks cancel (`hooks.commit`) only when the run
   * leaves the queue, the status is ambiguous, or a cancel is not confirmed. Submit is not a commit.
   */
  readonly cancelWhileQueued: boolean;
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
  /**
   * Fal only (late delivery, S2): the trusted output URL of a finished prediction, read fresh from the
   * provider. Throws when it is not available (expired 404, failed, untrusted host, network).
   */
  getPredictionOutput?(id: string): Promise<string>;
}
