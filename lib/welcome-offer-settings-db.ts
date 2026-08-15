import { supabaseServer } from "@/lib/supabase-server";

/**
 * Welcome-offer settings reader/updater (Pricing admin).
 *
 * Reads the singleton `welcome_offer_settings` row (key='global') via the
 * service role. Mirrors lib/welcome-bonus-settings-db.ts:
 *   - Read path NEVER throws. Missing row / query error -> safe default.
 *   - 60s in-memory TTL cache. A failed read is NOT cached (next call retries).
 *   - Writes bust the cache.
 *
 * This is presentational marketing config only — it gates whether the promo
 * popup (components/PromoOfferModal) auto-opens on the dashboard. It never
 * affects billing.
 */

export type WelcomeOfferSettings = {
  enabled: boolean;
};

// Default enabled, matching migration 062's seed (preserves the prior
// PROMO_ENABLED code-constant behaviour if the row is ever missing).
export const DEFAULT_WELCOME_OFFER_SETTINGS: WelcomeOfferSettings = {
  enabled: true,
};

const TABLE = "welcome_offer_settings";
const CACHE_TTL_MS = 60_000;

type WelcomeOfferCache = { settings: WelcomeOfferSettings | null; expiresAt: number };
let cache: WelcomeOfferCache = { settings: null, expiresAt: 0 };

type WelcomeOfferRow = {
  enabled: boolean | null;
};

function mapRow(row: WelcomeOfferRow): WelcomeOfferSettings {
  return { enabled: row.enabled === true };
}

/** Effective welcome-offer settings. Cached 60s; safe default on miss. */
export async function getWelcomeOfferSettings(): Promise<WelcomeOfferSettings> {
  const now = Date.now();
  if (cache.settings && now < cache.expiresAt) return cache.settings;

  try {
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select("enabled")
      .eq("key", "global")
      .maybeSingle();

    if (error || !data) {
      if (error) {
        console.warn("[welcome-offer] DB read failed, using defaults:", error.message);
      }
      return DEFAULT_WELCOME_OFFER_SETTINGS;
    }

    const settings = mapRow(data as WelcomeOfferRow);
    cache = { settings, expiresAt: now + CACHE_TTL_MS };
    return settings;
  } catch (e) {
    console.warn("[welcome-offer] read threw, using defaults:", e);
    return DEFAULT_WELCOME_OFFER_SETTINGS;
  }
}

/**
 * Update the singleton settings row. Fields are optional (partial patch).
 * Throws on DB error (the admin API surfaces it).
 */
export async function updateWelcomeOfferSettings(
  patch: Partial<WelcomeOfferSettings>,
  updatedByProfileId?: string | null
): Promise<WelcomeOfferSettings> {
  const row: Record<string, unknown> = { key: "global" };
  if ("enabled" in patch) row.enabled = patch.enabled;
  if (updatedByProfileId !== undefined) row.updated_by_profile_id = updatedByProfileId;

  const { data, error } = await supabaseServer
    .from(TABLE)
    .upsert(row, { onConflict: "key" })
    .select("enabled")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to update welcome offer settings.");
  }

  cache = { settings: null, expiresAt: 0 };
  return mapRow(data as WelcomeOfferRow);
}
