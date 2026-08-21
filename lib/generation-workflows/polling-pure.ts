export type ReplicateTerminalStatus =
  | "starting"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled"
  | "aborted";

export type PollTerminalDecision =
  | { terminal: false }
  | { terminal: true; outcome: "success"; outputUrl: string }
  | { terminal: true; outcome: "failed"; message: string }
  | { terminal: true; outcome: "cancelled"; message: string };

export function isReplicateInFlight(status: string): boolean {
  return status === "starting" || status === "processing";
}

export function resolvePollTerminalDecision(params: {
  status: string;
  output: unknown;
  error: unknown;
}): PollTerminalDecision {
  const status = params.status as ReplicateTerminalStatus;

  if (isReplicateInFlight(status)) {
    return { terminal: false };
  }

  if (status === "succeeded") {
    const outputUrl = extractMediaUrlFromOutput(params.output);
    if (!outputUrl.startsWith("http")) {
      return {
        terminal: true,
        outcome: "failed",
        message: "Provider succeeded but returned no usable media URL.",
      };
    }
    return { terminal: true, outcome: "success", outputUrl };
  }

  if (status === "failed") {
    const message =
      typeof params.error === "string"
        ? params.error
        : params.error
          ? JSON.stringify(params.error)
          : "Provider generation failed.";
    return { terminal: true, outcome: "failed", message };
  }

  if (status === "canceled" || status === "aborted") {
    return {
      terminal: true,
      outcome: "cancelled",
      message: "Generation cancelled.",
    };
  }

  return { terminal: false };
}

function extractMediaUrlFromOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (Array.isArray(output)) {
    for (const item of output) {
      const url = extractMediaUrlFromOutput(item);
      if (url.startsWith("http")) return url;
    }
    return "";
  }
  if (output && typeof output === "object") {
    const obj = output as Record<string, unknown>;
    if (typeof obj.url === "string") return obj.url;
    if (typeof obj.uri === "string") return obj.uri;
  }
  return "";
}
