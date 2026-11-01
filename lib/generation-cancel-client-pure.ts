/** Client-side outcome of a Cancel click (no React): lets the UI tell cancelled / refused / failed apart. */
export type CancelResult = "cancelling" | "not_allowed" | "failed" | "idle";

/** Shown after a run delivered although its cancel was accepted (unconfirmed Fal cancel): credits are used. */
export const CANCEL_DELIVERED_ANYWAY_MESSAGE = "Generation already started and can't be cancelled. Credits are used.";
/** The calm line that replaces Cancel once the server says cancel can't succeed (#472). Never claims a refund. */
export const CANCEL_LOCKED_MESSAGE = "Already generating, can't be cancelled.";
export const CANCEL_FAILED_MESSAGE = "Couldn't cancel. Please try again.";

type CancelFetch = (
  input: string,
  init: { method: "POST"; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** POST the cancel and classify the answer: 2xx accepted, 409 CANCEL_NOT_ALLOWED refused, anything else failed. */
export async function postGenerationCancel(fetchImpl: CancelFetch, idempotencyKey: string): Promise<CancelResult> {
  try {
    const res = await fetchImpl("/api/generations/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey }),
    });
    if (res.ok) return "cancelling";
    const data = (await res.json().catch(() => ({}))) as { code?: unknown } | null;
    return res.status === 409 && data?.code === "CANCEL_NOT_ALLOWED" ? "not_allowed" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * What the UI shows for a cancel result. A 409 is not an error: `refused` swaps the button for the calm
 * line at once, with no notice. Only a failed request shows a (retry) notice.
 */
export function cancelUiState(result: CancelResult): { refused: boolean; notice: string | null } {
  if (result === "not_allowed") return { refused: true, notice: null };
  if (result === "failed") return { refused: false, notice: CANCEL_FAILED_MESSAGE };
  return { refused: false, notice: null };
}

/**
 * The cancel control while a run is in flight: the Cancel button only while the server says cancel can
 * succeed (poll `cancelAllowed`, and no 409 seen yet), otherwise the calm `CANCEL_LOCKED_MESSAGE` line.
 */
export function cancelControl(state: { visible: boolean; cancelAllowed: boolean }): "hidden" | "cancel" | "locked" {
  if (!state.visible) return "hidden";
  return state.cancelAllowed ? "cancel" : "locked";
}

/** Cancel click for surfaces without a form banner (canvas nodes): runs the cancel and shows its notice, if any (a 409 has none). */
export async function cancelWithNotice(cancel: () => Promise<CancelResult>, show: (notice: string) => void): Promise<CancelResult> {
  const result = await cancel();
  const { notice } = cancelUiState(result);
  if (notice) show(notice);
  return result;
}
