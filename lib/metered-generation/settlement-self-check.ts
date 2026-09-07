import {
  resolveMeteredErrorJson,
  resolveMeteredSettlement,
  resolveMeteredSettlementKind,
  resolveMeteredSettlementMessage,
} from "./settlement-pure";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

/** ponytail: runnable without Supabase — terminal catch characterization invariants. */
export function meteredSettlementSelfCheck(): void {
  assert(
    resolveMeteredSettlementKind({
      cancelled: true,
      recoverable: true,
      pricingMissing: true,
    }) === "cancelled",
    "cancelled wins over recoverable and pricing",
  );
  assert(
    resolveMeteredSettlementKind({
      cancelled: false,
      recoverable: true,
      pricingMissing: true,
    }) === "recoverable",
    "recoverable wins over pricing",
  );
  assert(
    resolveMeteredSettlementMessage("cancelled", "provider blew up") ===
      "Generation cancelled.",
    "cancelled message is fixed",
  );
  assert(
    resolveMeteredSettlementMessage("generic_failure", "provider blew up") ===
      "provider blew up",
    "generic keeps raw message",
  );

  const cancelled = resolveMeteredSettlement({
    cancelled: true,
    recoverable: false,
    pricingMissing: false,
    rawMessage: "ignored",
    creditsSpent: true,
    creditsAmount: 12,
    hasProfileId: true,
    hasJobId: true,
    jobId: "job-1",
    hasGenerationRequestId: true,
  });
  assert(cancelled.kind === "cancelled", "cancelled kind");
  assert(cancelled.errorJson.code === "GENERATION_CANCELLED", "cancelled errJson code");
  assert(cancelled.httpStatus === 409, "cancelled is 409");
  assert(cancelled.httpBody.refunded === true, "cancelled body carries creditsSpent");
  assert(cancelled.jobAction === "cancel", "cancelled cancels job");
  assert(cancelled.refundEligible, "cancelled refunds when spent");
  assert(cancelled.refundMetadataReason === "generation_cancelled", "cancel refund reason");
  assert(cancelled.idempotencyAction === "failure", "cancel finishes idempotency as failure");
  assert(!cancelled.failAsset, "no asset → no failAsset");

  const recoverableVideo = resolveMeteredSettlement({
    cancelled: false,
    recoverable: true,
    pricingMissing: false,
    rawMessage: "rendi timed out",
    creditsSpent: true,
    creditsAmount: 30,
    hasProfileId: true,
    hasJobId: true,
    jobId: "job-v",
    hasGenerationRequestId: true,
    hasAsset: true,
    options: { recoverableJobAction: "skip", resumablePurge: true },
  });
  assert(recoverableVideo.httpStatus === 503, "recoverable is 503");
  assert(recoverableVideo.httpBody.recoverable === true, "recoverable body flag");
  assert(recoverableVideo.httpBody.refunded === false, "recoverable holds credits");
  assert(recoverableVideo.jobAction === "none", "video recoverable skips job mutation");
  assert(recoverableVideo.resumablePurge === "none", "recoverable never purges");
  assert(!recoverableVideo.refundEligible, "recoverable never refunds");
  assert(!recoverableVideo.failAsset, "recoverable skips failAsset");
  assert(recoverableVideo.idempotencyAction === "recoverable", "recoverable idempotency row");

  const recoverableReels = resolveMeteredSettlement({
    cancelled: false,
    recoverable: true,
    pricingMissing: false,
    rawMessage: "scene stitch failed",
    creditsSpent: true,
    creditsAmount: 40,
    hasProfileId: true,
    hasJobId: true,
    jobId: "job-r",
    hasJobType: true,
    hasGenerationRequestId: true,
    options: { recoverableJobAction: "mark_recoverable", resumablePurge: true },
  });
  assert(recoverableReels.jobAction === "mark_recoverable", "reels marks recoverable");

  const pricing = resolveMeteredSettlement({
    cancelled: false,
    recoverable: false,
    pricingMissing: true,
    rawMessage: "Unknown pricing key foo",
    creditsSpent: false,
    creditsAmount: 0,
    hasProfileId: true,
    hasJobId: false,
    hasGenerationRequestId: false,
  });
  assert(pricing.kind === "pricing_missing", "pricing kind");
  assert(
    resolveMeteredErrorJson("pricing_missing", pricing.message).code ===
      "PRICING_CONFIG_MISSING",
    "pricing errJson code",
  );
  assert(pricing.httpStatus === 500, "pricing is 500");
  assert(pricing.httpBody.code === "PRICING_CONFIG_MISSING", "pricing body code");
  assert(!pricing.refundEligible, "pricing missing never refunds");

  const generic = resolveMeteredSettlement({
    cancelled: false,
    recoverable: false,
    pricingMissing: false,
    rawMessage: "Replicate 500",
    creditsSpent: true,
    creditsAmount: 8,
    hasProfileId: true,
    hasJobId: true,
    jobId: "job-g",
    hasGenerationRequestId: true,
    hasAsset: true,
    options: { resumablePurge: true, failureRefundReason: "generation_failed" },
  });
  assert(generic.errorJson.code === undefined, "generic errJson has no code");
  assert(generic.jobAction === "fail", "generic fails job");
  assert(generic.resumablePurge === "purge", "generic purges when enabled");
  assert(generic.failAsset, "generic fails asset");
  assert(generic.refundEligible, "generic refunds when spent");
  assert(generic.refundMetadataReason === "generation_failed", "generation_failed reason");

  const importFail = resolveMeteredSettlement({
    cancelled: false,
    recoverable: false,
    pricingMissing: false,
    rawMessage: "vision parse failed",
    creditsSpent: true,
    creditsAmount: 2,
    hasProfileId: true,
    hasJobId: true,
    hasGenerationRequestId: true,
    options: { failureRefundReason: "import_failed" },
  });
  assert(
    importFail.refundDescription === "Best-effort refund after import failure",
    "import refund description",
  );
  assert(importFail.refundMetadataReason === "import_failed", "import refund metadata");

  const motionGeneric = resolveMeteredSettlement({
    cancelled: false,
    recoverable: false,
    pricingMissing: false,
    rawMessage: "Replicate 500",
    creditsSpent: false,
    creditsAmount: 0,
    hasProfileId: true,
    hasJobId: true,
    hasGenerationRequestId: true,
    genericClientError: "Motion control generation failed.",
  });
  assert(
    motionGeneric.httpBody.error === "Motion control generation failed.",
    "route generic client error override",
  );

  const photoSkipAsset = resolveMeteredSettlement({
    cancelled: false,
    recoverable: false,
    pricingMissing: false,
    rawMessage: "batch failed",
    creditsSpent: true,
    creditsAmount: 4,
    hasProfileId: true,
    hasJobId: true,
    hasAsset: true,
    skipFailAsset: true,
    hasGenerationRequestId: true,
  });
  assert(!photoSkipAsset.failAsset, "photo finalized assets skip failAsset");

  const reelsNoJobType = resolveMeteredSettlement({
    cancelled: false,
    recoverable: false,
    pricingMissing: false,
    rawMessage: "fail",
    creditsSpent: true,
    creditsAmount: 10,
    hasProfileId: true,
    hasJobId: true,
    hasJobType: false,
    hasGenerationRequestId: true,
    options: { requireJobTypeForRefund: true },
  });
  assert(!reelsNoJobType.refundEligible, "reels refund requires jobType");

  const cancelPurge = resolveMeteredSettlement({
    cancelled: true,
    recoverable: false,
    pricingMissing: false,
    rawMessage: "x",
    creditsSpent: false,
    creditsAmount: 0,
    hasProfileId: true,
    hasJobId: true,
    hasGenerationRequestId: false,
    options: { resumablePurge: true },
  });
  assert(cancelPurge.resumablePurge === "purge", "cancel purges resumable when enabled");
}

if (process.argv[1]?.includes("settlement-self-check")) {
  meteredSettlementSelfCheck();
  console.log("metered-settlement self-check ok");
}
