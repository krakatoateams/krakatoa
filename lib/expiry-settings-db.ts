import { supabaseServer } from "@/lib/supabase-server";

/**
 * Expiry settings reader/updater (Expiry Management admin).
 *
 * Reads the singleton `expiry_settings` row (key='global') via the service role.
 * Each value is a duration in DAYS; `null` means "never expires".
 *
 * Guarantees (read path):
 *   - NEVER throws. Missing row / query error / malformed values -> all-null
 *     defaults (nothing expires), consistent with lib/billing-settings-db.ts.
 *   - 60s in-memory TTL cache. A failed read is NOT cached so the next call
 *     retries. Writes bust the cache.
 */

export type CreditExpirySource = "regular" | "purchase_bonus" | "new_user_bonus";

export type ExpirySettings = {
  regularCreditDays: number | null;
  purchaseBonusCreditDays: number | null;
  newUserBonusCreditDays: number | null;
  photoCreationDays: number | null;
  videoCreationDays: number | null;
};

export const DEFAULT_EXPIRY_SETTINGS: ExpirySettings = {
  regularCreditDays: null,
  purchaseBonusCreditDays: null,
  newUserBonusCreditDays: null,
  photoCreationDays: null,
  videoCreationDays: null,
};

const TABLE = "expiry_settings";
const CACHE_TTL_MS = 60_000;

type ExpiryCache = { settings: ExpirySettings | null; expiresAt: number };
let cache: ExpiryCache = { settings: null, expiresAt: 0 };

type ExpirySettingsRow = {
  regular_credit_days: number | string | null;
  purchase_bonus_credit_days: number | string | null;
  new_user_bonus_credit_days: number | string | null;
  photo_creation_days: number | string | null;
  video_creation_days: number | string | null;
};

/** Coerce a DB value to a non-negative integer number of days, or null. */
function toDays(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function mapRow(row: ExpirySettingsRow): ExpirySettings {
  return {
    regularCreditDays: toDays(row.regular_credit_days),
    purchaseBonusCreditDays: toDays(row.purchase_bonus_credit_days),
    newUserBonusCreditDays: toDays(row.new_user_bonus_credit_days),
    photoCreationDays: toDays(row.photo_creation_days),
    videoCreationDays: toDays(row.video_creation_days),
  };
}

/** Effective expiry settings. Cached for 60s; safe all-null defaults on miss. */
export async function getExpirySettings(): Promise<ExpirySettings> {
  const now = Date.now();
  if (cache.settings && now < cache.expiresAt) return cache.settings;

  try {
    const { data, error } = await supabaseServer
      .from(TABLE)
      .select(
        "regular_credit_days, purchase_bonus_credit_days, new_user_bonus_credit_days, photo_creation_days, video_creation_days"
      )
      .eq("key", "global")
      .maybeSingle();

    if (error || !data) {
      if (error) {
        console.warn("[expiry-settings] DB read failed, using defaults:", error.message);
      }
      return DEFAULT_EXPIRY_SETTINGS;
    }

    const settings = mapRow(data as ExpirySettingsRow);
    cache = { settings, expiresAt: now + CACHE_TTL_MS };
    return settings;
  } catch (e) {
    console.warn("[expiry-settings] read threw, using defaults:", e);
    return DEFAULT_EXPIRY_SETTINGS;
  }
}

/**
 * Update the singleton settings row. Each field is optional; passing `null`
 * clears the expiry (never expires). Throws on DB error (admin API surfaces it).
 */
export async function updateExpirySettings(
  patch: Partial<ExpirySettings>,
  updatedByProfileId?: string | null
): Promise<ExpirySettings> {
  const row: Record<string, unknown> = { key: "global" };
  if ("regularCreditDays" in patch) row.regular_credit_days = patch.regularCreditDays;
  if ("purchaseBonusCreditDays" in patch)
    row.purchase_bonus_credit_days = patch.purchaseBonusCreditDays;
  if ("newUserBonusCreditDays" in patch)
    row.new_user_bonus_credit_days = patch.newUserBonusCreditDays;
  if ("photoCreationDays" in patch) row.photo_creation_days = patch.photoCreationDays;
  if ("videoCreationDays" in patch) row.video_creation_days = patch.videoCreationDays;
  if (updatedByProfileId !== undefined) row.updated_by_profile_id = updatedByProfileId;

  const { data, error } = await supabaseServer
    .from(TABLE)
    .upsert(row, { onConflict: "key" })
    .select(
      "regular_credit_days, purchase_bonus_credit_days, new_user_bonus_credit_days, photo_creation_days, video_creation_days"
    )
    .single();

  if (error || !data) {
    throw new Error(error?.message || "Failed to update expiry settings.");
  }

  // Bust the read cache so subsequent reads reflect the write immediately.
  cache = { settings: null, expiresAt: 0 };
  return mapRow(data as ExpirySettingsRow);
}

/**
 * Compute the absolute expiry timestamp for a credit grant of the given source,
 * or `null` when that source never expires. Used by the credit grant wrappers
 * to stamp a lot's `expires_at` at grant time.
 */
export function expiresAtFor(
  source: CreditExpirySource,
  settings: ExpirySettings,
  from: Date = new Date()
): Date | null {
  const days =
    source === "regular"
      ? settings.regularCreditDays
      : source === "purchase_bonus"
        ? settings.purchaseBonusCreditDays
        : settings.newUserBonusCreditDays;
  if (days === null || days <= 0) return null;
  return new Date(from.getTime() + days * 24 * 60 * 60 * 1000);
}
