import { parseWorkflowFinalizeResult } from "./finalization-pure";

export function finalizationSelfCheck(): void {
  const finalized = parseWorkflowFinalizeResult({
    action: "finalized",
    creationId: "c-1",
    storagePath: "u/videos/x.mp4",
    responseJson: {
      videoUrl: "https://example.com/x.mp4",
      storagePath: "u/videos/x.mp4",
      savedToCloud: true,
      historyItem: { id: "c-1", tool: "video_motion_control" },
    },
  });
  if (finalized.action !== "finalized" || !finalized.responseJson?.historyItem) {
    throw new Error("finalized must carry canonical responseJson with historyItem");
  }

  const stopWon = parseWorkflowFinalizeResult({
    action: "stop_won",
    storagePath: "u/videos/x.mp4",
  });
  if (stopWon.action !== "stop_won" || stopWon.responseJson) {
    throw new Error("stop_won must never carry a deliverable response");
  }

  const noop = parseWorkflowFinalizeResult({ action: "noop_already", replay: true });
  if (!noop.replay) {
    throw new Error("noop_already must replay");
  }

  try {
    parseWorkflowFinalizeResult({ action: "unknown" });
    throw new Error("unexpected action must throw");
  } catch (e) {
    if (!(e instanceof Error) || !e.message.includes("unexpected action")) {
      throw e;
    }
  }
}

if (process.argv[1]?.includes("finalization-self-check")) {
  finalizationSelfCheck();
  console.log("finalization self-check ok");
}
