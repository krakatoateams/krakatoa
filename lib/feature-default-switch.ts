/**
 * Make one feature row the default without ever leaving two defaults behind.
 * Order: compare-and-set the target first (a stale write changes nothing), then clear the other
 * rows. If clearing fails, the target is put back to its previous values before the error is
 * rethrown, so a DB error never persists a second default. Pure: the DB ops are injected.
 * ponytail: if the compensating write also fails, two defaults remain; the runtime resolver then
 * picks the first eligible one deterministically (lib/feature-enablement.ts).
 */
export async function setFeatureDefaultSafely<Row>(ops: {
  /** CAS write of the target row; null when it lost the compare-and-set. */
  writeTarget: () => Promise<Row | null>;
  /** True when the patch makes the target the default (other defaults must be cleared). */
  makesDefault: boolean;
  clearOthers: () => Promise<void>;
  /** Restore the target's pre-change values (no CAS). */
  revertTarget: () => Promise<void>;
  onCompensationFailed?: (e: unknown) => void;
}): Promise<Row | null> {
  const row = await ops.writeTarget();
  if (!row || !ops.makesDefault) return row;
  try {
    await ops.clearOthers();
  } catch (e) {
    try {
      await ops.revertTarget();
    } catch (revertError) {
      ops.onCompensationFailed?.(revertError);
    }
    throw e;
  }
  return row;
}
