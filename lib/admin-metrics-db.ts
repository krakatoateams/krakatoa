import { supabaseServer } from "@/lib/supabase-server";
import { getBillingSettings } from "@/lib/billing-settings-db";
import type { BillingSettings } from "@/lib/pricing-math";

/**
 * Read-only admin metrics (service-role, cross-profile).
 *
 * Aggregates ONLY existing database data — jobs, usage_events, credit_transactions,
 * credit_wallets, profiles. It never calls any external provider and never mutates
 * anything. Aggregation is done in JS over a capped row window for Phase Admin 1
 * simplicity; `capped: true` signals the window was hit (move to SQL aggregates
 * later if volume grows). credit_transactions remains the billing source of truth.
 */

const ROW_CAP = 5000;

// Supabase's untyped client infers embedded one-to-many relations as arrays even
// when the FK is many-to-one (a single row at runtime). These helpers read the
// joined profile defensively whether it comes back as an object or an array.
type ProfileEmbed =
  | { email?: string | null; display_name?: string | null }
  | { email?: string | null; display_name?: string | null }[]
  | null
  | undefined;

function embeddedProfile(
  p: ProfileEmbed
): { email?: string | null; display_name?: string | null } | null {
  if (!p) return null;
  return Array.isArray(p) ? (p[0] ?? null) : p;
}

function embeddedEmail(p: ProfileEmbed): string | null {
  return embeddedProfile(p)?.email ?? null;
}

async function countRows(
  table: string,
  filters?: Record<string, string>
): Promise<number> {
  let query = supabaseServer.from(table).select("id", { count: "exact", head: true });
  if (filters) {
    for (const [k, v] of Object.entries(filters)) query = query.eq(k, v);
  }
  const { count, error } = await query;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export type AdminSummary = {
  jobs: {
    total: number;
    byStatus: Record<string, number>;
    byTool: Record<string, number>;
    capped: boolean;
  };
  credits: {
    totalBalance: number;
    lifetimeSpent: number;
    lifetimePurchased: number;
    walletsCapped: boolean;
  };
  ledger: {
    spendCount: number;
    spendAmount: number;
    refundCount: number;
    refundAmount: number;
    windowCapped: boolean;
  };
  recentFailedJobs: RecentJob[];
};

export type RecentJob = {
  id: string;
  tool: string;
  job_type: string;
  status: string;
  cost_credits: number;
  provider: string | null;
  model: string | null;
  created_at: string;
  email: string | null;
};

type JobRow = {
  id: string;
  tool: string;
  job_type: string;
  status: string;
  cost_credits: number;
  provider: string | null;
  model: string | null;
  created_at: string;
  profiles?: ProfileEmbed;
};

function toRecentJob(row: JobRow): RecentJob {
  return {
    id: row.id,
    tool: row.tool,
    job_type: row.job_type,
    status: row.status,
    cost_credits: row.cost_credits,
    provider: row.provider,
    model: row.model,
    created_at: row.created_at,
    email: embeddedEmail(row.profiles),
  };
}

/** Overview numbers for the admin dashboard. */
export async function getAdminSummary(): Promise<AdminSummary> {
  const totalJobs = await countRows("jobs");

  const { data: jobRows, error: jobErr } = await supabaseServer
    .from("jobs")
    .select("tool, status, cost_credits, created_at")
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);
  if (jobErr) throw new Error(jobErr.message);

  const byStatus: Record<string, number> = {};
  const byTool: Record<string, number> = {};
  for (const r of (jobRows as { tool: string; status: string }[] | null) ?? []) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byTool[r.tool] = (byTool[r.tool] ?? 0) + 1;
  }

  const { data: walletRows, error: walletErr } = await supabaseServer
    .from("credit_wallets")
    .select("balance, lifetime_spent, lifetime_purchased")
    .limit(ROW_CAP);
  if (walletErr) throw new Error(walletErr.message);

  let totalBalance = 0;
  let lifetimeSpent = 0;
  let lifetimePurchased = 0;
  for (const w of (walletRows as {
    balance: number;
    lifetime_spent: number;
    lifetime_purchased: number;
  }[] | null) ?? []) {
    totalBalance += w.balance ?? 0;
    lifetimeSpent += w.lifetime_spent ?? 0;
    lifetimePurchased += w.lifetime_purchased ?? 0;
  }

  const { data: txRows, error: txErr } = await supabaseServer
    .from("credit_transactions")
    .select("amount, type, status, created_at")
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);
  if (txErr) throw new Error(txErr.message);

  let spendCount = 0;
  let spendAmount = 0;
  let refundCount = 0;
  let refundAmount = 0;
  for (const t of (txRows as {
    amount: number;
    type: string;
    status: string;
  }[] | null) ?? []) {
    if (t.status !== "succeeded") continue;
    if (t.type === "spend") {
      spendCount += 1;
      spendAmount += t.amount ?? 0;
    } else if (t.type === "refund") {
      refundCount += 1;
      refundAmount += t.amount ?? 0;
    }
  }

  const { data: failedRows, error: failedErr } = await supabaseServer
    .from("jobs")
    .select(
      "id, tool, job_type, status, cost_credits, provider, model, created_at, profiles(email)"
    )
    .eq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(10);
  if (failedErr) throw new Error(failedErr.message);

  return {
    jobs: {
      total: totalJobs,
      byStatus,
      byTool,
      capped: totalJobs > ROW_CAP,
    },
    credits: {
      totalBalance,
      lifetimeSpent,
      lifetimePurchased,
      walletsCapped: (walletRows?.length ?? 0) >= ROW_CAP,
    },
    ledger: {
      spendCount,
      spendAmount,
      refundCount,
      refundAmount,
      windowCapped: (txRows?.length ?? 0) >= ROW_CAP,
    },
    recentFailedJobs: ((failedRows as unknown as JobRow[] | null) ?? []).map(
      toRecentJob
    ),
  };
}

export type UsageAggregate = {
  tool: string;
  provider: string | null;
  model: string | null;
  events: number;
  units: number;
  creditsCharged: number;
  /** Real money value of the consumed credits in USD (credits × IDR/credit ÷ USD→IDR). */
  estimatedCostUsd: number;
  /** Real money value of the consumed credits in IDR (credits × credit_value_idr). */
  estimatedCostIdr: number;
};

/**
 * Usage events aggregated by tool/provider/model.
 *
 * Est. USD / Est. IDR are derived from the REAL credits charged and the live
 * billing settings (credit_value_idr, usd_to_idr) — i.e. the actual money value
 * of the credits consumed at the current provider-cost-based rates:
 *   est_idr = credits × credit_value_idr
 *   est_usd = est_idr ÷ usd_to_idr
 * (The legacy usage_events.estimated_cost_usd column is never populated, so we
 * compute from credits, which are themselves derived from real provider USD cost.)
 */
export async function getAdminUsage(): Promise<{
  aggregates: UsageAggregate[];
  totalEvents: number;
  capped: boolean;
  billingSettings: BillingSettings;
}> {
  const [totalEvents, billingSettings] = await Promise.all([
    countRows("usage_events"),
    getBillingSettings(),
  ]);

  const { data, error } = await supabaseServer
    .from("usage_events")
    .select("tool, provider, model, units, credits_charged, estimated_cost_usd, created_at")
    .order("created_at", { ascending: false })
    .limit(ROW_CAP);
  if (error) throw new Error(error.message);

  const map = new Map<string, UsageAggregate>();
  for (const r of (data as {
    tool: string;
    provider: string | null;
    model: string | null;
    units: number | null;
    credits_charged: number | null;
    estimated_cost_usd: number | null;
  }[] | null) ?? []) {
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
    };
    agg.events += 1;
    agg.units += r.units ?? 0;
    agg.creditsCharged += r.credits_charged ?? 0;
    map.set(key, agg);
  }

  // Derive money values from the summed credits using the live billing settings.
  const aggregates = Array.from(map.values())
    .map((agg) => {
      const estimatedCostIdr = agg.creditsCharged * billingSettings.creditValueIdr;
      const estimatedCostUsd =
        billingSettings.usdToIdr > 0 ? estimatedCostIdr / billingSettings.usdToIdr : 0;
      return { ...agg, estimatedCostIdr, estimatedCostUsd };
    })
    .sort((a, b) => b.events - a.events);
  return { aggregates, totalEvents, capped: totalEvents > ROW_CAP, billingSettings };
}

/** Recent jobs (optionally filtered), newest first. */
export async function getAdminJobs(options?: {
  tool?: string;
  status?: string;
  limit?: number;
}): Promise<RecentJob[]> {
  let query = supabaseServer
    .from("jobs")
    .select(
      "id, tool, job_type, status, cost_credits, provider, model, created_at, profiles(email)"
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(options?.limit ?? 50, 200));

  if (options?.tool) query = query.eq("tool", options.tool);
  if (options?.status) query = query.eq("status", options.status);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return ((data as unknown as JobRow[] | null) ?? []).map(toRecentJob);
}

export type LedgerEntry = {
  id: string;
  amount: number;
  direction: string;
  type: string;
  status: string;
  description: string | null;
  created_at: string;
  email: string | null;
};

export type TopUser = {
  profile_id: string;
  email: string | null;
  display_name: string | null;
  balance: number;
  lifetime_spent: number;
};

/** Recent credit transactions + top users by lifetime spend. */
export async function getAdminCredits(options?: { limit?: number }): Promise<{
  recentTransactions: LedgerEntry[];
  topUsers: TopUser[];
}> {
  const { data: txData, error: txErr } = await supabaseServer
    .from("credit_transactions")
    .select(
      "id, amount, direction, type, status, description, created_at, profiles(email)"
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(options?.limit ?? 50, 200));
  if (txErr) throw new Error(txErr.message);

  const recentTransactions: LedgerEntry[] = (
    (txData as unknown as
      | {
          id: string;
          amount: number;
          direction: string;
          type: string;
          status: string;
          description: string | null;
          created_at: string;
          profiles?: ProfileEmbed;
        }[]
      | null) ?? []
  ).map((t) => ({
    id: t.id,
    amount: t.amount,
    direction: t.direction,
    type: t.type,
    status: t.status,
    description: t.description,
    created_at: t.created_at,
    email: embeddedEmail(t.profiles),
  }));

  const { data: walletData, error: walletErr } = await supabaseServer
    .from("credit_wallets")
    .select("profile_id, balance, lifetime_spent, profiles(email, display_name)")
    .order("lifetime_spent", { ascending: false })
    .limit(10);
  if (walletErr) throw new Error(walletErr.message);

  const topUsers: TopUser[] = (
    (walletData as unknown as
      | {
          profile_id: string;
          balance: number;
          lifetime_spent: number;
          profiles?: ProfileEmbed;
        }[]
      | null) ?? []
  ).map((w) => {
    const prof = embeddedProfile(w.profiles);
    return {
      profile_id: w.profile_id,
      email: prof?.email ?? null,
      display_name: prof?.display_name ?? null,
      balance: w.balance,
      lifetime_spent: w.lifetime_spent,
    };
  });

  return { recentTransactions, topUsers };
}
