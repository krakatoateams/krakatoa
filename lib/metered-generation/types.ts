/** Terminal catch outcome — priority: cancelled > recoverable > pricing_missing > generic_failure. */
export type MeteredSettlementKind =
  | "cancelled"
  | "recoverable"
  | "pricing_missing"
  | "generic_failure";

export type MeteredJobAction = "cancel" | "fail" | "mark_recoverable" | "none";

export type MeteredResumablePurgeAction = "purge" | "none";

export type MeteredIdempotencyAction = "recoverable" | "failure" | "none";

export type MeteredFailureRefundReason = "generation_failed" | "import_failed";

export type MeteredErrorJson = {
  message: string;
  code?: string;
};

export type MeteredSettlementOptions = {
  /** Reels marks recoverable in catch; video/storyboard-video skip fail/cancel. */
  recoverableJobAction?: "mark_recoverable" | "skip";
  /** Purge `{userId}/resumable/{jobId}/` on cancel or terminal fail. */
  resumablePurge?: boolean;
  /** Refund metadata.reason for non-cancel terminal outcomes. */
  failureRefundReason?: MeteredFailureRefundReason;
  /** Reels refund gate also requires jobType (spend key namespace). */
  requireJobTypeForRefund?: boolean;
};

/** Classification I/O (cancel post-commit, recoverable artifact probe) stays outside. */
export type MeteredSettlementInput = {
  cancelled: boolean;
  recoverable: boolean;
  pricingMissing: boolean;
  rawMessage: string;
  creditsSpent: boolean;
  creditsAmount: number;
  hasProfileId: boolean;
  hasJobId: boolean;
  jobId?: string | null;
  hasJobType?: boolean;
  hasGenerationRequestId: boolean;
  hasAsset?: boolean;
  /** Photo: success path already finalized assets — skip failAsset. */
  skipFailAsset?: boolean;
  /** Route-specific generic 500 `error` field (e.g. motion-control fallback). */
  genericClientError?: string;
  options?: MeteredSettlementOptions;
};

export type MeteredSettlementPlan = {
  kind: MeteredSettlementKind;
  message: string;
  errorJson: MeteredErrorJson;
  httpStatus: 409 | 503 | 500;
  httpBody: Record<string, unknown>;
  failAsset: boolean;
  jobAction: MeteredJobAction;
  resumablePurge: MeteredResumablePurgeAction;
  refundEligible: boolean;
  refundDescription: string | null;
  refundMetadataReason: "generation_cancelled" | MeteredFailureRefundReason | null;
  idempotencyAction: MeteredIdempotencyAction;
  logLevel: "cancel" | "recoverable" | "error";
};
