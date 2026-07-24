/**
 * Predefined credit packs — the single source of truth for what users can buy.
 *
 * Reused from the marketing packs in components/landing/PricingSectionAlt.tsx.
 * DOKU charges in IDR, so each pack carries an explicit `priceIdr` (derived from
 * the original USD price at ~Rp18,000/USD, matching billing_settings.usd_to_idr).
 *
 * SERVER-AUTHORITATIVE: the checkout route resolves credits + amount from this
 * table by `id`. The client only ever sends a `packId` — never an amount or a
 * credit count — so a tampered request can't mint credits or change the price.
 */
export type CreditPack = {
  id: string;
  /** Headline (base) credits advertised for the pack. */
  credits: number;
  /** Extra credits granted on top of `credits` as a promotional bonus. */
  bonusCredits?: number;
  /** Price charged via DOKU, in whole IDR (no decimals). */
  priceIdr: number;
  /** Short marketing label. */
  label: string;
  /** Highlight in the UI. */
  popular?: boolean;
};

/**
 * Built-in default tiers. These are the seed source for the `credit_packs`
 * table (migration 052) AND the runtime fallback used when the table is
 * unavailable. Admin edits live in the DB — read them via lib/credit-packs-db.ts
 * (server) or the public /api/credits/packs endpoint (client).
 */
export const DEFAULT_CREDIT_PACKS: CreditPack[] = [
  { id: "p1", credits: 100, priceIdr: 27_000, label: "Starter" },
  { id: "p3", credits: 250, priceIdr: 67_500, label: "Creator", popular: true },
  { id: "p4", credits: 500, bonusCredits: 25, priceIdr: 135_000, label: "Pro" },
  { id: "p5", credits: 1_000, bonusCredits: 100, priceIdr: 270_000, label: "Studio" },
];

/** @deprecated Use DEFAULT_CREDIT_PACKS (fallback) or the DB-backed reader. */
export const CREDIT_PACKS = DEFAULT_CREDIT_PACKS;

/** Resolve a default pack by id, or undefined when unknown (fallback only). */
export function getCreditPack(id: string): CreditPack | undefined {
  return DEFAULT_CREDIT_PACKS.find((p) => p.id === id);
}

/** Total credits actually granted for a pack (base + bonus). */
export function packTotalCredits(pack: CreditPack): number {
  return pack.credits + (pack.bonusCredits ?? 0);
}

/**
 * Cosmetic IDR value of the bonus credits, priced at the pack's own base
 * rate (priceIdr / credits). Used only to show a "Saved Rp X" hint — it does
 * not affect the amount charged.
 */
export function packBonusValueIdr(pack: CreditPack): number {
  if (!pack.bonusCredits) return 0;
  const perCredit = pack.priceIdr / pack.credits;
  return Math.round(pack.bonusCredits * perCredit);
}

/** Format a whole-IDR amount as e.g. "Rp180.000". */
export function formatIdr(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}
