/** Client-side outcome of a Cancel click (no React): lets the UI tell cancelled / refused / failed apart. */
export type CancelResult = "cancelling" | "not_allowed" | "failed" | "idle";

export const CANCEL_NOT_ALLOWED_MESSAGE = "Generation already started and can't be cancelled. Credits are used.";
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

/** What the UI shows for a cancel result: `refused` swaps the button to "Finalizing…" at once. */
export function cancelUiState(result: CancelResult): { refused: boolean; notice: string | null } {
  if (result === "not_allowed") return { refused: true, notice: CANCEL_NOT_ALLOWED_MESSAGE };
  if (result === "failed") return { refused: false, notice: CANCEL_FAILED_MESSAGE };
  return { refused: false, notice: null };
}
