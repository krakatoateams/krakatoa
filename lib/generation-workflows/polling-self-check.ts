import { isReplicateInFlight, resolvePollTerminalDecision } from "./polling-pure";

export function pollingSelfCheck(): void {
  if (!isReplicateInFlight("processing")) {
    throw new Error("processing must be in-flight");
  }
  if (isReplicateInFlight("succeeded")) {
    throw new Error("succeeded must not be in-flight");
  }

  const success = resolvePollTerminalDecision({
    status: "succeeded",
    output: "https://example.com/out.mp4",
    error: null,
  });
  if (!success.terminal || success.outcome !== "success") {
    throw new Error("succeeded status must terminal success");
  }

  const failed = resolvePollTerminalDecision({
    status: "failed",
    output: null,
    error: "boom",
  });
  if (!failed.terminal || failed.outcome !== "failed") {
    throw new Error("failed status must terminal failed");
  }

  const cancelled = resolvePollTerminalDecision({
    status: "canceled",
    output: null,
    error: null,
  });
  if (!cancelled.terminal || cancelled.outcome !== "cancelled") {
    throw new Error("canceled status must terminal cancelled");
  }

  const pending = resolvePollTerminalDecision({
    status: "starting",
    output: null,
    error: null,
  });
  if (pending.terminal) {
    throw new Error("starting must not terminal");
  }
}

if (process.argv[1]?.includes("polling-self-check")) {
  pollingSelfCheck();
  console.log("polling self-check ok");
}
