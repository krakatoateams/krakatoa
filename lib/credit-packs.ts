/**
 * Predefined credit packs — the single source of truth for what users can buy.
 *
 * Each pack has an IDR price (charged by DOKU) and a USD price (display-only
 * until Polar checkout is connected). Dummy USD amounts match ~Rp18,000/USD.
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
  /** Display price for USD checkout, in cents. Dummy until Polar is connected. */
  priceUsdCents: number;
  /** Short marketing label. */
  label: string;
  /** Highlight in the UI. */
  popular?: boolean;
};

/**
 * Built-in default tiers. These seed the `credit_packs` table (migration 052)
 * and provide an immediate client loading state. Server reads fail closed when
 * the table is unavailable; checkout never authorizes these static values.
 */
export const DEFAULT_CREDIT_PACKS: CreditPack[] = [
  { id: "p1", credits: 100, priceIdr: 27_000, priceUsdCents: 150, label: "Starter" },
  { id: "p3", credits: 250, priceIdr: 67_500, priceUsdCents: 375, label: "Creator", popular: true },
  { id: "p4", credits: 500, bonusCredits: 25, priceIdr: 135_000, priceUsdCents: 750, label: "Pro" },
  { id: "p5", credits: 1_000, bonusCredits: 100, priceIdr: 270_000, priceUsdCents: 1_500, label: "Studio" },
];

/** @deprecated Use DEFAULT_CREDIT_PACKS (fallback) or the DB-backed reader. */
export const CREDIT_PACKS = DEFAULT_CREDIT_PACKS;

/**
 * Empty and failed DB reads both disable pack display. Admins may intentionally
 * disable every pack, and an outage must not advertise stale prices.
 */
export function creditPacksFromDbRows(
  rows: CreditPack[] | null
): CreditPack[] {
  return rows ?? [];
}

/** Parse the public packs payload while preserving an explicit empty array. */
export function creditPacksFromApiPayload(payload: unknown): CreditPack[] | null {
  if (!payload || typeof payload !== "object") return null;
  const packs = (payload as { packs?: unknown }).packs;
  return Array.isArray(packs) ? (packs as CreditPack[]) : null;
}

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

/** Cosmetic USD value of the bonus credits, in cents. */
export function packBonusValueUsdCents(pack: CreditPack): number {
  if (!pack.bonusCredits) return 0;
  const perCredit = pack.priceUsdCents / pack.credits;
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

/** Format integer cents as e.g. "$1.50". */
export function formatUsd(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
}

export type PackCurrency = "USD" | "IDR";

export function formatPackPrice(pack: CreditPack, currency: PackCurrency): string {
  return currency === "USD" ? formatUsd(pack.priceUsdCents ?? 0) : formatIdr(pack.priceIdr);
}

export function formatPackBonus(pack: CreditPack, currency: PackCurrency): string {
  return currency === "USD"
    ? formatUsd(packBonusValueUsdCents(pack))
    : formatIdr(packBonusValueIdr(pack));
}
