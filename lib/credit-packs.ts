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
  /** Credits granted on successful purchase. */
  credits: number;
  /** Price charged via DOKU, in whole IDR (no decimals). */
  priceIdr: number;
  /** Short marketing label. */
  label: string;
  /** Highlight in the UI. */
  popular?: boolean;
};

export const CREDIT_PACKS: CreditPack[] = [
  { id: "p1", credits: 100, priceIdr: 27_000, label: "Starter" },
  { id: "p3", credits: 660, priceIdr: 180_000, label: "Creator", popular: true },
  { id: "p4", credits: 1_320, priceIdr: 360_000, label: "Pro" },
  { id: "p5", credits: 3_500, priceIdr: 900_000, label: "Studio" },
];

/** Resolve a pack by id, or undefined when unknown. */
export function getCreditPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((p) => p.id === id);
}

/** Format a whole-IDR amount as e.g. "Rp180.000". */
export function formatIdr(amount: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(amount);
}
