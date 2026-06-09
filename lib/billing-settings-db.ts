import { supabaseServer } from "@/lib/supabase-server";
import {
  type BillingSettings,
  DEFAULT_BILLING_SETTINGS,
  normalizeBillingSettings,
} from "@/lib/pricing-math";

/**
 * Billing settings reader (Pricing Config v2.1).
 *
 * Reads the singleton `billing_settings` row (key='global') via the service role
 * and maps it to the camelCase BillingSettings shape used by lib/pricing-math.ts.
 *
 * Guarantees:
 *   - NEVER throws.
 *   - Missing row / query error / malformed values -> DEFAULT_BILLING_SETTINGS.
 *   - 60s in-memory TTL cache, consistent with lib/pricing-resolver.ts. A failed
 *     read is NOT cached so the next call retries.
 *   - Reads no secrets and touches no payment/external services.
 */

const CACHE_TTL_MS = 60_000;

type BillingCache = {
  settings: BillingSettings | null;
  expiresAt: number;
};

let cache: BillingCache = { settings: null, expiresAt: 0 };

type BillingSettingsRow = {
  usd_to_idr: number | string | null;
  credit_value_idr: number | string | null;
  margin_multiplier: number | string | null;
  rounding_mode: string | null;
};

function toNumber(v: number | string | null | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/** Map a DB row (numeric columns may arrive as strings) to BillingSettings. */
function mapRow(row: BillingSettingsRow): BillingSettings {
  return normalizeBillingSettings({
    usdToIdr: toNumber(row.usd_to_idr),
    creditValueIdr: toNumber(row.credit_value_idr),
    marginMultiplier: toNumber(row.margin_multiplier),
    roundingMode: "ceil_final",
  });
}

/**
 * Effective billing settings. Cached for 60s; safe defaults on any miss/error.
 */
export async function getBillingSettings(): Promise<BillingSettings> {
  const now = Date.now();
  if (cache.settings && now < cache.expiresAt) return cache.settings;

  try {
    const { data, error } = await supabaseServer
      .from("billing_settings")
      .select("usd_to_idr, credit_value_idr, margin_multiplier, rounding_mode")
      .eq("key", "global")
      .maybeSingle();

    if (error || !data) {
      if (error) {
        console.warn("[billing-settings] DB read failed, using defaults:", error.message);
      }
      return DEFAULT_BILLING_SETTINGS;
    }

    const settings = mapRow(data as BillingSettingsRow);
    cache = { settings, expiresAt: now + CACHE_TTL_MS };
    return settings;
  } catch (e) {
    console.warn("[billing-settings] read threw, using defaults:", e);
    return DEFAULT_BILLING_SETTINGS;
  }
}
