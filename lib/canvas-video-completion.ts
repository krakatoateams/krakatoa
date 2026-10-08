/** Terminal-state handling for Canvas video generation (non-terminal 202 / "processing"). */

export const CANVAS_VIDEO_NOT_SAVED_MESSAGE =
  "The video finished but couldn't be saved. Please try again.";
export const CANVAS_VIDEO_TIMEOUT_MESSAGE =
  "The video is taking longer than expected. Check your library shortly.";

export type CanvasVideoResult = { videoUrl?: string; storagePath?: string; historyItem?: { id?: string; storagePath?: string } | null };

export type CanvasVideoStatus =
  | { kind: "pending" }
  | { kind: "success"; result: CanvasVideoResult }
  | { kind: "error"; message: string; cancelled?: boolean };

/** A saved video must carry a URL or storage path; anything else is a false success. */
export function hasSavedVideo(result: unknown): result is CanvasVideoResult {
  if (!result || typeof result !== "object") return false;
  const r = result as CanvasVideoResult;
  return (
    (typeof r.videoUrl === "string" && r.videoUrl.length > 0) ||
    (typeof r.storagePath === "string" && r.storagePath.length > 0)
  );
}

/** Interpret one `/api/generations/status` payload; only explicit terminal states end polling. */
export function interpretCanvasVideoStatus(data: {
  status?: string;
  result?: unknown;
  error?: { message?: string; code?: string } | null;
}): CanvasVideoStatus {
  if (data.status === "succeeded") {
    return hasSavedVideo(data.result)
      ? { kind: "success", result: data.result }
      : { kind: "error", message: CANVAS_VIDEO_NOT_SAVED_MESSAGE };
  }
  if (data.status === "failed") {
    return {
      kind: "error",
      message: data.error?.message || "Generation failed.",
      cancelled: data.error?.code === "GENERATION_CANCELLED",
    };
  }
  return { kind: "pending" };
}

export async function pollCanvasVideoResult(
  idempotencyKey: string,
  opts: { pollMs?: number; maxMs?: number } = {},
): Promise<CanvasVideoResult> {
  const pollMs = opts.pollMs ?? 3000;
  const deadline = Date.now() + (opts.maxMs ?? 15 * 60 * 1000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const res = await fetch("/api/generations/status", {
      headers: { "Idempotency-Key": idempotencyKey },
    }).catch(() => null);
    if (!res) continue; // transient network error; keep the lock and retry
    if (res.status === 404 || res.status === 401) {
      throw new Error("Couldn't retrieve the finished video. Check your library shortly.");
    }
    if (!res.ok) continue;
    const next = interpretCanvasVideoStatus(await res.json().catch(() => ({})));
    if (next.kind === "success") return next.result;
    if (next.kind === "error") {
      throw Object.assign(new Error(next.message), {
        code: next.cancelled ? "GENERATION_CANCELLED" : undefined,
      });
    }
  }
  throw new Error(CANVAS_VIDEO_TIMEOUT_MESSAGE);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

if (require.main === module) {
  assert(interpretCanvasVideoStatus({ status: "started" }).kind === "pending", "started is pending");
  assert(interpretCanvasVideoStatus({ status: "processing" }).kind === "pending", "processing is pending");
  const ok = interpretCanvasVideoStatus({ status: "succeeded", result: { storagePath: "u/v.mp4" } });
  assert(ok.kind === "success", "succeeded with path is success");
  const empty = interpretCanvasVideoStatus({ status: "succeeded", result: {} });
  assert(empty.kind === "error" && empty.message === CANVAS_VIDEO_NOT_SAVED_MESSAGE, "empty success is an error");
  const failed = interpretCanvasVideoStatus({ status: "failed", error: { message: "Boom." } });
  assert(failed.kind === "error" && failed.message === "Boom.", "failed surfaces message");
  const cancelled = interpretCanvasVideoStatus({ status: "failed", error: { code: "GENERATION_CANCELLED", message: "Generation cancelled." } });
  assert(cancelled.kind === "error" && cancelled.cancelled === true, "cancel flagged");
  assert(!hasSavedVideo({ videoUrl: "" }), "empty url is not saved");
  console.log("canvasVideoCompletionSelfCheck: ok");
}
