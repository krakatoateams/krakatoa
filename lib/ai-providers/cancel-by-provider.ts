import type { PhotoProvider } from "./photo-provider";

/**
 * Cancel prediction ids with the provider that created them (recorded at submit time),
 * never the currently configured one. Best-effort: an unknown/unconfigured provider is
 * skipped (its ids count as requested, not cancelled). Never throws.
 */
export async function cancelByRecordedProvider(
  idsByProvider: Record<string, string[]>,
  getProvider: (id: string) => Pick<PhotoProvider, "cancelPredictions"> | null,
): Promise<{ predictions: number; cancelled: number }> {
  let predictions = 0;
  let cancelled = 0;
  await Promise.all(
    Object.entries(idsByProvider).map(async ([providerId, ids]) => {
      predictions += ids.length;
      const adapter = getProvider(providerId);
      if (!adapter) {
        console.warn(`[generation-cancel] no adapter for recorded provider "${providerId}"; skipping ${ids.length} id(s).`);
        return;
      }
      try {
        const res = await adapter.cancelPredictions(ids); // read before adding: `+= await` would race across groups
        cancelled += res.cancelled;
      } catch {
        // cancelPredictions is best-effort by contract; never fail the cancel request.
      }
    }),
  );
  return { predictions, cancelled };
}
