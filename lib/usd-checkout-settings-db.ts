import { supabaseServer } from "@/lib/supabase-server";

export type UsdCheckoutSettings = { enabled: boolean };

export const DEFAULT_USD_CHECKOUT_SETTINGS: UsdCheckoutSettings = { enabled: false };

const TABLE = "usd_checkout_settings";
const CACHE_TTL_MS = 60_000;

let cache: { settings: UsdCheckoutSettings | null; expiresAt: number } = {
  settings: null,
  expiresAt: 0,
};

function bustCache(): void {
  cache = { settings: null, expiresAt: 0 };
}

/** Customer-facing USD checkout switch. Missing table or errors stay hidden. */
export async function getUsdCheckoutSettings(): Promise<UsdCheckoutSettings> {
  const now = Date.now();
  if (cache.settings && now < cache.expiresAt) return cache.settings;

  try {
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select("enabled")
      .eq("key", "global")
      .maybeSingle();

    if (error || !data) return DEFAULT_USD_CHECKOUT_SETTINGS;

    const settings = { enabled: (data as { enabled: boolean | null }).enabled === true };
    cache = { settings, expiresAt: now + CACHE_TTL_MS };
    return settings;
  } catch {
    return DEFAULT_USD_CHECKOUT_SETTINGS;
  }
}

export async function updateUsdCheckoutSettings(
  enabled: boolean,
  updatedByProfileId?: string | null
): Promise<UsdCheckoutSettings> {
  const { data, error } = await supabaseServer
    .from(TABLE)
    .upsert(
      { key: "global", enabled, updated_by_profile_id: updatedByProfileId ?? null },
      { onConflict: "key" }
    )
    .select("enabled")
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to update USD checkout settings.");
  }
  bustCache();
  return { enabled: (data as { enabled: boolean }).enabled === true };
}
