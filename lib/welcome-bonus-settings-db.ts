import { supabaseServer } from "@/lib/supabase-server";
import { normalizeWelcomeBonusCreditAmount } from "@/lib/welcome-bonus-validation";

/**
 * Welcome-bonus settings reader/updater (Pricing admin).
 *
 * Reads the singleton `welcome_bonus_settings` row (key='global') via the
 * service role. Mirrors lib/expiry-settings-db.ts:
 *   - Read path NEVER throws. Missing row / query error -> safe disabled default.
 *   - 60s in-memory TTL cache. A failed read is NOT cached (next call retries).
 *   - Writes bust the cache.
 *
 * Since migration 089, the on-demand welcome-video eligibility/claim flow reads
 * this row; regular users are no longer auto-granted credits at profile insert.
 */

export type WelcomeBonusSettings = {
  enabled: boolean;
  creditAmount: number;
};

export const DEFAULT_WELCOME_BONUS_SETTINGS: WelcomeBonusSettings = {
  enabled: false,
  creditAmount: 0,
};

const TABLE = "welcome_bonus_settings";
const CACHE_TTL_MS = 60_000;

type WelcomeBonusCache = { settings: WelcomeBonusSettings | null; expiresAt: number };
let cache: WelcomeBonusCache = { settings: null, expiresAt: 0 };

type WelcomeBonusRow = {
  enabled: boolean | null;
  credit_amount: number | string | null;
};

function mapRow(row: WelcomeBonusRow): WelcomeBonusSettings {
  return {
    enabled: row.enabled === true,
    creditAmount: normalizeWelcomeBonusCreditAmount(row.credit_amount),
  };
}

/** Effective welcome-bonus settings. Cached 60s; safe disabled default on miss. */
export async function getWelcomeBonusSettings(): Promise<WelcomeBonusSettings> {
  const now = Date.now();
  if (cache.settings && now < cache.expiresAt) return cache.settings;

  try {
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select("enabled, credit_amount")
      .eq("key", "global")
      .maybeSingle();

    if (error || !data) {
      if (error) {
        console.warn("[welcome-bonus] DB read failed, using defaults:", error.message);
      }
      return DEFAULT_WELCOME_BONUS_SETTINGS;
    }

    const settings = mapRow(data as WelcomeBonusRow);
    cache = { settings, expiresAt: now + CACHE_TTL_MS };
    return settings;
  } catch (e) {
    console.warn("[welcome-bonus] read threw, using defaults:", e);
    return DEFAULT_WELCOME_BONUS_SETTINGS;
  }
}

/**
 * Update the singleton settings row. Fields are optional (partial patch).
 * Throws on DB error (the admin API surfaces it).
 */
export async function updateWelcomeBonusSettings(
  patch: Partial<WelcomeBonusSettings>,
  updatedByProfileId?: string | null
): Promise<WelcomeBonusSettings> {
  const row: Record<string, unknown> = { key: "global" };
  if ("enabled" in patch) row.enabled = patch.enabled;
  if ("creditAmount" in patch) row.credit_amount = patch.creditAmount;
  if (updatedByProfileId !== undefined) row.updated_by_profile_id = updatedByProfileId;

  const { data, error } = await supabaseServer
    .from(TABLE)
    .upsert(row, { onConflict: "key" })
    .select("enabled, credit_amount")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to update welcome bonus settings.");
  }

  cache = { settings: null, expiresAt: 0 };
  return mapRow(data as WelcomeBonusRow);
}
