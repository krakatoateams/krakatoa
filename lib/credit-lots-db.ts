import { supabaseServer } from "@/lib/supabase-server";

/**
 * Customer-facing view of the credit lot ledger (per-source expiry).
 *
 * Reads a profile's remaining active lots so the UI can show WHICH credits
 * expire and WHEN. Read path never throws — a missing table / query error
 * returns an empty summary so the Credits tab degrades gracefully.
 *
 * Consumption is soonest-expiry-first (see the RPC in 050), so the buckets here
 * double as "what gets spent next".
 */

export type CreditLotSource =
  | "regular"
  | "purchase_bonus"
  | "new_user_bonus"
  | "refund"
  | "adjustment"
  | "legacy";

export type ActiveLot = {
  source: CreditLotSource | string;
  amountRemaining: number;
  expiresAt: string | null;
};

/** One merged row for display: credits of a source sharing one expiry date. */
export type CreditBucket = {
  source: CreditLotSource | string;
  amount: number;
  expiresAt: string | null;
};

export type CreditLotSummary = {
  /** Merged buckets, soonest expiry first (never-expiring last). */
  buckets: CreditBucket[];
  /** Credits expiring within `withinDays`, plus the soonest expiry timestamp. */
  expiringSoon: { amount: number; withinDays: number; nextExpiryAt: string | null };
  /** Credits that never expire. */
  neverExpires: number;
  /** Sum of all remaining lot credits (should equal wallet balance). */
  totalTracked: number;
};

type LotRow = {
  source: string;
  amount_remaining: number;
  expires_at: string | null;
};

/** Active, non-empty lots for a profile, soonest expiry first (nulls last). */
export async function listActiveLotsForProfile(profileId: string): Promise<ActiveLot[]> {
  try {
    const { data, error } = await supabaseServer
      .from("credit_lots")
      .select("source, amount_remaining, expires_at")
      .eq("profile_id", profileId)
      .eq("status", "active")
      .gt("amount_remaining", 0)
      .order("expires_at", { ascending: true, nullsFirst: false });

    if (error || !data) {
      if (error) console.warn("[credit-lots] read failed:", error.message);
      return [];
    }
    return (data as LotRow[]).map((r) => ({
      source: r.source,
      amountRemaining: r.amount_remaining,
      expiresAt: r.expires_at,
    }));
  } catch (e) {
    console.warn("[credit-lots] read threw:", e);
    return [];
  }
}

/** Merge lots by (source, expiry) and compute the expiring-soon summary. */
export function summarizeCreditLots(
  lots: ActiveLot[],
  soonWindowDays = 30,
  now: Date = new Date()
): CreditLotSummary {
  const merged = new Map<string, CreditBucket>();
  for (const lot of lots) {
    const key = `${lot.source}|${lot.expiresAt ?? "never"}`;
    const existing = merged.get(key);
    if (existing) existing.amount += lot.amountRemaining;
    else
      merged.set(key, {
        source: lot.source,
        amount: lot.amountRemaining,
        expiresAt: lot.expiresAt,
      });
  }

  const buckets = Array.from(merged.values()).sort((a, b) => {
    if (a.expiresAt === b.expiresAt) return 0;
    if (a.expiresAt === null) return 1;
    if (b.expiresAt === null) return -1;
    return a.expiresAt < b.expiresAt ? -1 : 1;
  });

  const soonCutoff = now.getTime() + soonWindowDays * 24 * 60 * 60 * 1000;
  let expiringSoonAmount = 0;
  let nextExpiryAt: string | null = null;
  let neverExpires = 0;
  let totalTracked = 0;

  for (const b of buckets) {
    totalTracked += b.amount;
    if (b.expiresAt === null) {
      neverExpires += b.amount;
      continue;
    }
    const t = new Date(b.expiresAt).getTime();
    if (nextExpiryAt === null || t < new Date(nextExpiryAt).getTime()) {
      nextExpiryAt = b.expiresAt;
    }
    if (t <= soonCutoff) expiringSoonAmount += b.amount;
  }

  return {
    buckets,
    expiringSoon: {
      amount: expiringSoonAmount,
      withinDays: soonWindowDays,
      nextExpiryAt,
    },
    neverExpires,
    totalTracked,
  };
}

/** Convenience: read + summarize in one call. */
export async function getCreditLotSummary(
  profileId: string,
  soonWindowDays = 30
): Promise<CreditLotSummary> {
  const lots = await listActiveLotsForProfile(profileId);
  return summarizeCreditLots(lots, soonWindowDays);
}
