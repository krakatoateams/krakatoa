/**
 * Limited-time promo config — presentational only.
 *
 * References existing credit packs (lib/credit-packs.ts) by id and layers on a
 * cosmetic "list price" so the modal can show a struck-through original price
 * and a "% OFF" badge. The amount actually charged is still each pack's real
 * `priceIdr`, resolved server-side by /api/credits/checkout — nothing here
 * affects billing.
 */
import {
  formatIdr,
  packTotalCredits,
  type CreditPack,
} from "@/lib/credit-packs";

export { formatIdr, packTotalCredits };

/** Master switch — flip to false to retire the promo without removing code. */
export const PROMO_ENABLED = true;

/** ISO deadline. Drives the "before <date>" note and auto-hides once passed. */
export const PROMO_DEADLINE = "2026-09-30T23:59:59+07:00";

/** Cinematic hero band at the top of the modal. */
export const PROMO_HERO_IMAGE = "/landing/about/generate-social-post.png";

export const PROMO_COPY = {
  eyebrow: "Limited time",
  headlinePrefix: "Up to",
  headlinePercent: "60%",
  headlineSuffix: "OFF",
  subcopy: "Lock in launch pricing on Kelolako credit packs",
} as const;

export type PromoTier = {
  /** Must match an id in the credit_packs list (DEFAULT_CREDIT_PACKS fallback). */
  packId: string;
  /** Cosmetic list price shown struck-through. Never charged. */
  originalPriceIdr: number;
  /** Pre-select this tier and use its discount for the CTA label. */
  recommended?: boolean;
};

export const PROMO_TIERS: PromoTier[] = [
  { packId: "p4", originalPriceIdr: 225_000 },
  { packId: "p5", originalPriceIdr: 675_000, recommended: true },
];

/** Whole-percent discount of the real price vs. the cosmetic list price. */
export function promoDiscountPct(pack: CreditPack, tier: PromoTier): number {
  if (!tier.originalPriceIdr || tier.originalPriceIdr <= pack.priceIdr) return 0;
  return Math.round((1 - pack.priceIdr / tier.originalPriceIdr) * 100);
}

/** Formatted deadline for the "before <date>" note, e.g. "Sep 30, 2026". */
export function formatPromoDeadline(iso: string = PROMO_DEADLINE): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** True while the promo is enabled and the deadline hasn't passed. */
export function isPromoLive(now: number = Date.now()): boolean {
  return PROMO_ENABLED && now < new Date(PROMO_DEADLINE).getTime();
}
