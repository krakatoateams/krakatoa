import type {
  MeteredErrorJson,
  MeteredSettlementInput,
  MeteredSettlementKind,
  MeteredSettlementPlan,
} from "./types";

const CANCELLED_MESSAGE = "Generation cancelled.";

export function resolveMeteredSettlementKind(input: {
  cancelled: boolean;
  recoverable: boolean;
  pricingMissing: boolean;
}): MeteredSettlementKind {
  if (input.cancelled) return "cancelled";
  if (input.recoverable) return "recoverable";
  if (input.pricingMissing) return "pricing_missing";
  return "generic_failure";
}

export function resolveMeteredSettlementMessage(
  kind: MeteredSettlementKind,
  rawMessage: string,
): string {
  return kind === "cancelled" ? CANCELLED_MESSAGE : rawMessage;
}

export function resolveMeteredErrorJson(
  kind: MeteredSettlementKind,
  message: string,
): MeteredErrorJson {
  switch (kind) {
    case "cancelled":
      return { message, code: "GENERATION_CANCELLED" };
    case "recoverable":
      return { message, code: "PIPELINE_RECOVERABLE" };
    case "pricing_missing":
      return { message, code: "PRICING_CONFIG_MISSING" };
    case "generic_failure":
      return { message };
  }
}

function resolveHttp(
  kind: MeteredSettlementKind,
  message: string,
  input: MeteredSettlementInput,
): Pick<MeteredSettlementPlan, "httpStatus" | "httpBody"> {
  const clientError = input.genericClientError ?? message;
  switch (kind) {
    case "cancelled":
      return {
        httpStatus: 409,
        httpBody: {
          error: message,
          code: "GENERATION_CANCELLED",
          refunded: input.creditsSpent,
        },
      };
    case "recoverable":
      return {
        httpStatus: 503,
        httpBody: {
          recoverable: true,
          jobId: input.jobId ?? null,
          error: message,
          code: "PIPELINE_RECOVERABLE",
          refunded: false,
        },
      };
    case "pricing_missing":
      return {
        httpStatus: 500,
        httpBody: { error: clientError, code: "PRICING_CONFIG_MISSING" },
      };
    case "generic_failure":
      return { httpStatus: 500, httpBody: { error: clientError } };
  }
}

/** Shared terminal-catch decision matrix — no DB, storage, or HTTP I/O. */
export function resolveMeteredSettlement(
  input: MeteredSettlementInput,
): MeteredSettlementPlan {
  const opts = input.options ?? {};
  const kind = resolveMeteredSettlementKind(input);
  const message = resolveMeteredSettlementMessage(kind, input.rawMessage);
  const errorJson = resolveMeteredErrorJson(kind, message);
  const { httpStatus, httpBody } = resolveHttp(kind, message, input);

  const recoverable = kind === "recoverable";
  const terminalFail = kind === "generic_failure" || kind === "pricing_missing";

  let jobAction: MeteredSettlementPlan["jobAction"];
  if (kind === "cancelled") {
    jobAction = "cancel";
  } else if (recoverable) {
    jobAction =
      opts.recoverableJobAction === "mark_recoverable" ? "mark_recoverable" : "none";
  } else {
    jobAction = "fail";
  }

  const resumablePurge: MeteredSettlementPlan["resumablePurge"] =
    opts.resumablePurge && (kind === "cancelled" || terminalFail) ? "purge" : "none";

  const refundEligible =
    input.creditsSpent &&
    input.hasProfileId &&
    input.creditsAmount > 0 &&
    !recoverable &&
    (!opts.requireJobTypeForRefund || !!input.hasJobType);

  const failureReason = opts.failureRefundReason ?? "generation_failed";

  let idempotencyAction: MeteredSettlementPlan["idempotencyAction"] = "none";
  if (input.hasGenerationRequestId) {
    idempotencyAction =
      recoverable && input.hasJobId ? "recoverable" : "failure";
  }

  return {
    kind,
    message,
    errorJson,
    httpStatus,
    httpBody,
    failAsset: !!input.hasAsset && !recoverable && !input.skipFailAsset,
    jobAction,
    resumablePurge,
    refundEligible,
    refundDescription: refundEligible
      ? kind === "cancelled"
        ? "Refund after user cancellation"
        : failureReason === "import_failed"
          ? "Best-effort refund after import failure"
          : "Best-effort refund after generation failure"
      : null,
    refundMetadataReason: refundEligible
      ? kind === "cancelled"
        ? "generation_cancelled"
        : failureReason
      : null,
    idempotencyAction,
    logLevel:
      kind === "cancelled"
        ? "cancel"
        : recoverable
          ? "recoverable"
          : "error",
  };
}
