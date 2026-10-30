import { supabaseServer } from "@/lib/supabase-server";

/**
 * Per-(provider, model, pricing_key) provider cost (migration 114). Margin and
 * analytics only: billing reads pricing_configs.credit_amount and never this table.
 */
export type ProviderModelCost = {
  provider: string;
  model: string;
  pricing_key: string;
  cost_usd: number;
  cost_unit: string;
  updated_by_profile_id: string | null;
  updated_at: string;
};

const TABLE = "provider_model_costs";

export async function listProviderModelCosts(): Promise<ProviderModelCost[]> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .select("*")
    .order("provider")
    .order("model")
    .order("pricing_key");
  if (error) throw new Error(error.message || "Failed to list provider costs.");
  return (data as ProviderModelCost[] | null) ?? [];
}

/** Update the cost of an existing row (rows are seeded; this never creates one). */
export async function updateProviderModelCost(
  key: { provider: string; model: string; pricing_key: string },
  costUsd: number,
  updatedByProfileId: string | null
): Promise<ProviderModelCost | null> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .update({ cost_usd: costUsd, updated_by_profile_id: updatedByProfileId })
    .eq("provider", key.provider)
    .eq("model", key.model)
    .eq("pricing_key", key.pricing_key)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message || "Failed to update provider cost.");
  return (data as ProviderModelCost | null) ?? null;
}
