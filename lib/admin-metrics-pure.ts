export const ADMIN_LIST_DEFAULT = 50;
export const ADMIN_LIST_MAX = 200;

/**
 * Jobs / credits list limits. Matches the documented default 50 / max 200,
 * and rejects zero or negative values the way `readPageParams` rejects them.
 */
export function clampAdminListLimit(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return ADMIN_LIST_DEFAULT;
  return Math.min(Math.floor(n), ADMIN_LIST_MAX);
}

/** Banner copy when a 5000-row JS window is incomplete. */
export function adminMetricsCapNotice(capped: boolean): string | null {
  return capped
    ? "Window capped at the newest 5000 rows — breakdowns are incomplete."
    : null;
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`admin-metrics-pure self-check: ${message}`);
}

export function adminMetricsPureSelfCheck(): void {
  assert(clampAdminListLimit(undefined) === ADMIN_LIST_DEFAULT, "missing limit uses default");
  assert(clampAdminListLimit(999) === ADMIN_LIST_MAX, "list limit must cap at 200");
  assert(clampAdminListLimit(-1) === ADMIN_LIST_DEFAULT, "negative list limit must not reach the query");
  assert(clampAdminListLimit(0) === ADMIN_LIST_DEFAULT, "zero list limit must not reach the query");
  assert(clampAdminListLimit(5.9) === 5, "fractional list limit must floor");
  assert(adminMetricsCapNotice(false) === null, "no banner when the window is complete");
  assert(
    Boolean(adminMetricsCapNotice(true)?.includes("5000")),
    "capped window must tell the operator the breakdown is incomplete",
  );
}

if (require.main === module) {
  adminMetricsPureSelfCheck();
  console.log("admin-metrics-pure self-check passed");
}
