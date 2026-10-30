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

export type UsageCostSource = "provider_cost" | "estimated" | "mixed";

export type UsageEventRow = {
  tool: string;
  provider: string | null;
  model: string | null;
  units: number | null;
  credits_charged: number | null;
  metadata?: Record<string, unknown> | null;
};

export type UsageAggregateRow = {
  tool: string;
  provider: string | null;
  model: string | null;
  events: number;
  units: number;
  creditsCharged: number;
  /** USD cost: provider_model_costs × units where a row matches, else credits-based estimate. */
  estimatedCostUsd: number;
  /** IDR cost: USD × usd_to_idr for provider-cost events, credits × credit_value_idr otherwise. */
  estimatedCostIdr: number;
  costSource: UsageCostSource;
  /** Events priced from a provider_model_costs row. */
  providerCostEvents: number;
};

type CostRow = { provider: string; model: string; pricing_key: string; cost_usd: number };

/**
 * Analytics only: prices each usage event from provider_model_costs
 * (provider + model + metadata.pricingKey), falling back per event to the
 * credits-based estimate. Never throws or drops an event for a missing row.
 */
export function aggregateUsageEvents(
  rows: UsageEventRow[],
  costs: CostRow[],
  settings: { creditValueIdr: number; usdToIdr: number },
): UsageAggregateRow[] {
  const costMap = new Map<string, number>();
  for (const c of costs) costMap.set(`${c.provider}||${c.model}||${c.pricing_key}`, Number(c.cost_usd));

  const map = new Map<string, UsageAggregateRow>();
  for (const r of rows) {
    const key = `${r.tool}||${r.provider ?? ""}||${r.model ?? ""}`;
    const agg = map.get(key) ?? {
      tool: r.tool,
      provider: r.provider,
      model: r.model,
      events: 0,
      units: 0,
      creditsCharged: 0,
      estimatedCostUsd: 0,
      estimatedCostIdr: 0,
      costSource: "estimated" as UsageCostSource,
      providerCostEvents: 0,
    };
    const units = r.units ?? 0;
    const credits = r.credits_charged ?? 0;
    const pricingKey = r.metadata?.pricingKey;
    const unitCost =
      r.provider && r.model && typeof pricingKey === "string"
        ? costMap.get(`${r.provider}||${r.model}||${pricingKey}`)
        : undefined;
    agg.events += 1;
    agg.units += units;
    agg.creditsCharged += credits;
    if (unitCost !== undefined && Number.isFinite(unitCost)) {
      const usd = unitCost * units;
      agg.estimatedCostUsd += usd;
      agg.estimatedCostIdr += usd * settings.usdToIdr;
      agg.providerCostEvents += 1;
    } else {
      const idr = credits * settings.creditValueIdr;
      agg.estimatedCostIdr += idr;
      agg.estimatedCostUsd += settings.usdToIdr > 0 ? idr / settings.usdToIdr : 0;
    }
    map.set(key, agg);
  }
  for (const agg of map.values()) {
    agg.costSource =
      agg.providerCostEvents === 0 ? "estimated" : agg.providerCostEvents === agg.events ? "provider_cost" : "mixed";
  }
  return Array.from(map.values()).sort((a, b) => b.events - a.events);
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

  const settings = { creditValueIdr: 1000, usdToIdr: 16000 };
  const costs = [{ provider: "fal", model: "nano", pricing_key: "k1", cost_usd: 0.04 }];
  const ev = (o: Partial<UsageEventRow>): UsageEventRow => ({
    tool: "photo", provider: "fal", model: "nano", units: 2, credits_charged: 16, metadata: { pricingKey: "k1" }, ...o,
  });
  const hit = aggregateUsageEvents([ev({})], costs, settings)[0];
  assert(Math.abs(hit.estimatedCostUsd - 0.08) < 1e-9, "match must be cost_usd x units");
  assert(Math.abs(hit.estimatedCostIdr - 0.08 * 16000) < 1e-6, "IDR must be USD x usd_to_idr");
  assert(hit.costSource === "provider_cost" && hit.providerCostEvents === 1, "matched aggregate is provider_cost");
  const fbs = aggregateUsageEvents(
    [ev({ metadata: {} }), ev({ metadata: null }), ev({ provider: null }), ev({ model: "dev_blank" }), ev({ metadata: { pricingKey: "zz" } })],
    costs, settings,
  );
  assert(fbs.every((g) => g.costSource === "estimated" && g.providerCostEvents === 0), "unmatched events fall back to the estimate");
  assert(
    fbs.reduce((n, g) => n + g.events, 0) === 5 && fbs.reduce((n, g) => n + g.estimatedCostUsd, 0) === 5,
    "fallback is credits x credit_value_idr and no event is dropped",
  );
  const mixed = aggregateUsageEvents([ev({}), ev({ metadata: {} })], costs, settings)[0];
  assert(mixed.costSource === "mixed" && mixed.providerCostEvents === 1 && mixed.events === 2, "both kinds are mixed");
  const none = aggregateUsageEvents([ev({})], [], settings)[0];
  assert(none.costSource === "estimated" && none.estimatedCostUsd === 1, "missing/empty cost table falls back, keeps event");
}

if (require.main === module) {
  adminMetricsPureSelfCheck();
  console.log("admin-metrics-pure self-check passed");
}
