/** Pure: group rows by recorded provider; a missing provider means Replicate (pre-114 rows). */
export function groupPredictionIdsByProvider(
  rows: { prediction_id: unknown; provider?: string | null }[]
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of rows) {
    if (typeof r.prediction_id !== "string" || !r.prediction_id) continue;
    (out[r.provider || "replicate"] ??= []).push(r.prediction_id);
  }
  return out;
}
