import { supabaseServer } from "@/lib/supabase-server";

/**
 * Usage events: provider/model usage + estimated cost, for analytics and cost
 * visibility ONLY. These rows never affect a wallet balance — credit_transactions
 * remains the billing source of truth. Every read is scoped by profile_id.
 */

export type UsageEvent = {
  id: string;
  profile_id: string;
  job_id: string | null;
  asset_id: string | null;
  tool: string;
  provider: string | null;
  model: string | null;
  unit_type: string | null;
  units: number | null;
  estimated_cost_usd: number | null;
  credits_charged: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

const USAGE_EVENTS_TABLE = "usage_events";

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (
    error.message.includes("usage_events") &&
    (error.message.includes("schema cache") ||
      error.message.includes("does not exist"))
  ) {
    throw new Error(
      "Database table usage_events is missing. Run: npm run db:setup — or apply supabase/migrations/004_credits.sql."
    );
  }
  throw new Error(error.message || fallback);
}

/**
 * Record a usage event. Analytics only — this NEVER mutates wallet balance or
 * the credit ledger. `creditsCharged` is a denormalized snapshot for reporting,
 * not a billing instruction.
 */
export async function recordUsageEvent(params: {
  profileId: string;
  tool: string;
  jobId?: string | null;
  assetId?: string | null;
  provider?: string;
  model?: string;
  unitType?: string;
  units?: number;
  estimatedCostUsd?: number;
  creditsCharged?: number;
  metadata?: Record<string, unknown>;
}): Promise<UsageEvent> {
  const { data, error } = await supabaseServer
    .from(USAGE_EVENTS_TABLE)
    .insert({
      profile_id: params.profileId,
      job_id: params.jobId ?? null,
      asset_id: params.assetId ?? null,
      tool: params.tool,
      provider: params.provider ?? null,
      model: params.model ?? null,
      unit_type: params.unitType ?? null,
      units: params.units ?? null,
      estimated_cost_usd: params.estimatedCostUsd ?? null,
      credits_charged: params.creditsCharged ?? null,
      metadata: params.metadata ?? {},
    })
    .select("*")
    .single();

  handleError(error, "Failed to record usage event.");
  return data as UsageEvent;
}

/** List a profile's usage events (newest first). */
export async function listUsageEvents(
  profileId: string,
  options?: {
    tool?: string;
    jobId?: string;
    provider?: string;
    limit?: number;
  }
): Promise<UsageEvent[]> {
  let query = supabaseServer
    .from(USAGE_EVENTS_TABLE)
    .select("*")
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(options?.limit ?? 100);

  if (options?.tool) query = query.eq("tool", options.tool);
  if (options?.jobId) query = query.eq("job_id", options.jobId);
  if (options?.provider) query = query.eq("provider", options.provider);

  const { data, error } = await query;
  handleError(error, "Failed to list usage events.");
  return (data as UsageEvent[] | null) ?? [];
}
