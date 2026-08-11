import { supabaseServer } from "@/lib/supabase-server";
import { getBillingSettings } from "@/lib/billing-settings-db";

/**
 * Read-only admin analytics (service-role, cross-profile).
 *
 * Unlike lib/admin-metrics-db.ts — which aggregates in JS over a capped 5000-row
 * window and silently truncates past that — the group-bys here run as Postgres
 * functions (migration 060), so totals stay exact as the tables grow. The two
 * unbounded lists (new users, daily rollup) are paginated server-side.
 *
 * On "cost vs revenue": revenue is real money from paid credit_orders. The cost
 * side is credits CONSUMED valued at the current credit_value_idr — not provider
 * spend, which the platform does not persist (usage_events.estimated_cost_usd is
 * never written). Consumption routinely exceeds revenue because welcome and
 * bonus credits are granted free; that gap is the giveaway burn, not a loss.
 */

export type DailyMetric = {
  day: string;
  activeUsers: number;
  jobs: number;
  creditsSpent: number;
  paidOrders: number;
  revenueIdr: number;
  /** creditsSpent valued at the current credit_value_idr. */
  consumptionIdr: number;
  /** revenueIdr - consumptionIdr. Negative means credits were given away. */
  netIdr: number;
};

export type NewUser = {
  id: string;
  email: string | null;
  country: string | null;
  createdAt: string;
  creditsUsed: number;
  balance: number;
};

export type FeatureUsage = {
  jobType: string;
  tool: string | null;
  runs: number;
  succeeded: number;
  failed: number;
  credits: number;
};

export type ModelUsage = {
  provider: string;
  model: string;
  tool: string | null;
  runs: number;
  credits: number;
};

export type PackSale = {
  packId: string;
  label: string;
  orders: number;
  creditsSold: number;
  revenueIdr: number;
};

export type CountryBreakdown = {
  country: string;
  users: number;
};

export type AnalyticsHeadline = {
  /** Lifetime IDR from paid orders. */
  revenueIdr: number;
  paidOrders: number;
  creditsSpent: number;
  consumptionIdr: number;
  netIdr: number;
  totalUsers: number;
  /** Users who have spent at least one credit. */
  spendingUsers: number;
  /** creditsSpent / spendingUsers, rounded. 0 when nobody has spent yet. */
  avgCreditsPerSpendingUser: number;
  newUsersLast30Days: number;
  /** Distinct profiles that ran a job today (UTC). */
  dauToday: number;
  creditValueIdr: number;
};

export type AdminAnalytics = {
  headline: AnalyticsHeadline;
  features: FeatureUsage[];
  models: ModelUsage[];
  packs: PackSale[];
  countries: CountryBreakdown[];
};

export type Paged<T> = {
  rows: T[];
  total: number;
};

const MISSING_FN_HINT =
  "Analytics functions are missing. Apply supabase/migrations/060_admin_analytics.sql (npm run db:setup or the Supabase SQL Editor).";

function isMissingFunction(message: string): boolean {
  return (
    /could not find the function/i.test(message) ||
    /does not exist/i.test(message) ||
    /schema cache/i.test(message)
  );
}

async function callRpc<T>(fn: string): Promise<T[]> {
  const { data, error } = await supabaseServer.rpc(fn);
  if (error) {
    if (isMissingFunction(error.message)) throw new Error(MISSING_FN_HINT);
    throw new Error(error.message);
  }
  return (data ?? []) as T[];
}

function num(v: unknown): number {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return Number.isFinite(n) ? n : 0;
}

// Postgres bigint arrives over PostgREST as a string, so every count goes
// through num() rather than being trusted as a JS number.
type DailyRow = {
  day: string;
  active_users: number | string;
  jobs_count: number | string;
  credits_spent: number | string;
  paid_orders: number | string;
  revenue_idr: number | string;
};

function toDailyMetric(row: DailyRow, creditValueIdr: number): DailyMetric {
  const creditsSpent = num(row.credits_spent);
  const revenueIdr = num(row.revenue_idr);
  const consumptionIdr = Math.round(creditsSpent * creditValueIdr);
  return {
    day: row.day,
    activeUsers: num(row.active_users),
    jobs: num(row.jobs_count),
    creditsSpent,
    paidOrders: num(row.paid_orders),
    revenueIdr,
    consumptionIdr,
    netIdr: revenueIdr - consumptionIdr,
  };
}

/** Aggregates small enough to return whole (tens of rows) plus headline totals. */
export async function getAdminAnalytics(): Promise<AdminAnalytics> {
  const settings = await getBillingSettings();
  const creditValueIdr = settings.creditValueIdr;

  const [dailyRows, featureRows, modelRows, packRows, countryRows] =
    await Promise.all([
      callRpc<DailyRow>("krakatoa_admin_daily_metrics"),
      callRpc<{
        job_type: string;
        tool: string | null;
        runs: number | string;
        succeeded: number | string;
        failed: number | string;
        credits: number | string;
      }>("krakatoa_admin_feature_usage"),
      callRpc<{
        provider: string;
        model: string;
        tool: string | null;
        runs: number | string;
        credits: number | string;
      }>("krakatoa_admin_model_usage"),
      callRpc<{
        pack_id: string;
        label: string;
        orders: number | string;
        credits_sold: number | string;
        revenue_idr: number | string;
      }>("krakatoa_admin_pack_sales"),
      callRpc<{ country: string; users: number | string }>(
        "krakatoa_admin_country_breakdown"
      ),
    ]);

  const daily = dailyRows.map((r) => toDailyMetric(r, creditValueIdr));

  const revenueIdr = daily.reduce((sum, d) => sum + d.revenueIdr, 0);
  const paidOrders = daily.reduce((sum, d) => sum + d.paidOrders, 0);
  const creditsSpent = daily.reduce((sum, d) => sum + d.creditsSpent, 0);
  const consumptionIdr = Math.round(creditsSpent * creditValueIdr);

  const totalUsers = countryRows.reduce((sum, c) => sum + num(c.users), 0);

  const [spendingUsers, newUsersLast30Days] = await Promise.all([
    countSpendingUsers(),
    countNewUsersSince(30),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const dauToday = daily.find((d) => d.day === today)?.activeUsers ?? 0;

  return {
    headline: {
      revenueIdr,
      paidOrders,
      creditsSpent,
      consumptionIdr,
      netIdr: revenueIdr - consumptionIdr,
      totalUsers,
      spendingUsers,
      avgCreditsPerSpendingUser:
        spendingUsers > 0 ? Math.round(creditsSpent / spendingUsers) : 0,
      newUsersLast30Days,
      dauToday,
      creditValueIdr,
    },
    features: featureRows.map((r) => ({
      jobType: r.job_type,
      tool: r.tool,
      runs: num(r.runs),
      succeeded: num(r.succeeded),
      failed: num(r.failed),
      credits: num(r.credits),
    })),
    models: modelRows.map((r) => ({
      provider: r.provider,
      model: r.model,
      tool: r.tool,
      runs: num(r.runs),
      credits: num(r.credits),
    })),
    packs: packRows.map((r) => ({
      packId: r.pack_id,
      label: r.label,
      orders: num(r.orders),
      creditsSold: num(r.credits_sold),
      revenueIdr: num(r.revenue_idr),
    })),
    countries: countryRows.map((r) => ({
      country: r.country,
      users: num(r.users),
    })),
  };
}

async function countSpendingUsers(): Promise<number> {
  const { count, error } = await supabaseServer
    .from("credit_wallets")
    .select("id", { count: "exact", head: true })
    .gt("lifetime_spent", 0);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function countNewUsersSince(days: number): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { count, error } = await supabaseServer
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

/**
 * Newest profiles first.
 *
 * created_at is when the profile row was created, which is the user's first
 * authenticated app request rather than the exact auth.users signup instant —
 * profiles are created lazily. The two are normally seconds apart.
 */
export async function getNewUsers(params: {
  limit: number;
  offset: number;
}): Promise<Paged<NewUser>> {
  const { data, count, error } = await supabaseServer
    .from("profiles")
    .select("id, email, country, created_at, credit_wallets(balance, lifetime_spent)", {
      count: "exact",
    })
    .order("created_at", { ascending: false })
    .range(params.offset, params.offset + params.limit - 1);

  if (error) {
    // profiles.country also ships in 060, so point at the same fix.
    if (isMissingFunction(error.message)) throw new Error(MISSING_FN_HINT);
    throw new Error(error.message);
  }

  type WalletEmbed =
    | { balance?: number | null; lifetime_spent?: number | null }
    | { balance?: number | null; lifetime_spent?: number | null }[]
    | null
    | undefined;

  // credit_wallets is 1:1 with profiles, but the untyped client types the
  // embed as an array — read it defensively either way.
  const wallet = (w: WalletEmbed) => (Array.isArray(w) ? (w[0] ?? null) : w);

  const rows: NewUser[] = (data ?? []).map((r) => {
    const row = r as {
      id: string;
      email: string | null;
      country: string | null;
      created_at: string;
      credit_wallets?: WalletEmbed;
    };
    const w = wallet(row.credit_wallets);
    return {
      id: row.id,
      email: row.email,
      country: row.country,
      createdAt: row.created_at,
      creditsUsed: w?.lifetime_spent ?? 0,
      balance: w?.balance ?? 0,
    };
  });

  return { rows, total: count ?? rows.length };
}

/** Daily rollup, newest day first. Powers both the Sales and DAU tables. */
export async function getDailyMetrics(params: {
  limit: number;
  offset: number;
}): Promise<Paged<DailyMetric>> {
  const settings = await getBillingSettings();
  const all = await callRpc<DailyRow>("krakatoa_admin_daily_metrics");
  const page = all.slice(params.offset, params.offset + params.limit);
  return {
    rows: page.map((r) => toDailyMetric(r, settings.creditValueIdr)),
    total: all.length,
  };
}
