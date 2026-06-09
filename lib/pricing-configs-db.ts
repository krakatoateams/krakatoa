import { supabaseServer } from "@/lib/supabase-server";

/**
 * Pricing configs data access (service-role).
 *
 * Mirrors lib/credit-costs.ts so admins can view/edit credit pricing from the
 * panel. Phase Admin 2 wired lib/pricing-resolver.ts, so generation routes now
 * read these values at runtime WITH a fallback to the lib/credit-costs.ts
 * constants (and a ~60s TTL cache). Reset-to-default values live in
 * lib/admin-config-defaults.ts — keep SQL seed, resolver fallback, and reset
 * defaults aligned.
 */

export type PricingType = "fixed" | "per_second" | "per_image";

export type PricingConfig = {
  id: string;
  pricing_key: string;
  display_name: string;
  pricing_type: PricingType;
  credit_amount: number;
  enabled: boolean;
  metadata: Record<string, unknown>;
  updated_by_profile_id: string | null;
  created_at: string;
  updated_at: string;
};

const PRICING_CONFIGS_TABLE = "pricing_configs";

function handleError(error: { message: string } | null, fallback: string): void {
  if (!error) return;
  if (
    error.message.includes("pricing_configs") &&
    (error.message.includes("schema cache") ||
      error.message.includes("does not exist"))
  ) {
    throw new Error(
      "Database table pricing_configs is missing. Run: npm run db:setup — or apply supabase/migrations/007_admin_panel.sql."
    );
  }
  throw new Error(error.message || fallback);
}

/** List all pricing configs ordered by pricing_key. */
export async function listPricingConfigs(): Promise<PricingConfig[]> {
  const { data, error } = await supabaseServer
    .from(PRICING_CONFIGS_TABLE)
    .select("*")
    .order("pricing_key", { ascending: true });

  handleError(error, "Failed to list pricing configs.");
  return (data as PricingConfig[] | null) ?? [];
}

export type PricingConfigPatch = {
  display_name?: string;
  pricing_type?: PricingType;
  credit_amount?: number;
  enabled?: boolean;
  metadata?: Record<string, unknown>;
};

/** Update a single pricing config by pricing_key. Returns the row or null. */
export async function updatePricingConfig(
  pricingKey: string,
  patch: PricingConfigPatch,
  updatedByProfileId: string | null
): Promise<PricingConfig | null> {
  const update: Record<string, unknown> = { updated_by_profile_id: updatedByProfileId };
  if (patch.display_name !== undefined) update.display_name = patch.display_name;
  if (patch.pricing_type !== undefined) update.pricing_type = patch.pricing_type;
  if (patch.credit_amount !== undefined) update.credit_amount = patch.credit_amount;
  if (patch.enabled !== undefined) update.enabled = patch.enabled;
  if (patch.metadata !== undefined) update.metadata = patch.metadata;

  const { data, error } = await supabaseServer
    .from(PRICING_CONFIGS_TABLE)
    .update(update)
    .eq("pricing_key", pricingKey)
    .select("*")
    .maybeSingle();

  handleError(error, "Failed to update pricing config.");
  return (data as PricingConfig | null) ?? null;
}
