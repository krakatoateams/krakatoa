"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Check, Loader2, X } from "lucide-react";
import { useCreditPacks } from "@/lib/use-credit-packs";
import { CREDITS_PER_IMAGE, CREDITS_PER_VIDEO } from "@/lib/landing-content";
import { DEFAULT_CREDIT_PACKS, type CreditPack } from "@/lib/credit-packs";
import {
  PROMO_COPY,
  PROMO_HERO_IMAGE,
  PROMO_TIERS,
  formatIdr,
  formatPromoDeadline,
  packTotalCredits,
  promoDiscountPct,
  type PromoTier,
} from "@/lib/promo-offer";

type ResolvedTier = { tier: PromoTier; pack: CreditPack; discount: number };

/**
 * Limited-time promo popup. Presentational marketing over existing credit
 * packs: it shows a cosmetic struck-through "original" price and a "% OFF"
 * badge, but the CTA drives the unchanged, server-authoritative DOKU checkout
 * (POST /api/credits/checkout → redirect to paymentUrl) for the selected pack.
 */
export default function PromoOfferModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const packs = useCreditPacks();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Map configured tiers → live packs (fall back to static defaults), keeping
  // config order. Tiers whose pack id no longer exists are dropped.
  const tiers = useMemo<ResolvedTier[]>(() => {
    const source = packs.length ? packs : DEFAULT_CREDIT_PACKS;
    return PROMO_TIERS.flatMap((tier) => {
      const pack = source.find((p) => p.id === tier.packId);
      if (!pack) return [];
      return [{ tier, pack, discount: promoDiscountPct(pack, tier) }];
    });
  }, [packs]);

  // Default the selection to the recommended tier (else the first one).
  useEffect(() => {
    if (!open || tiers.length === 0) return;
    setSelectedId((prev) => {
      if (prev && tiers.some((t) => t.pack.id === prev)) return prev;
      const recommended = tiers.find((t) => t.tier.recommended) ?? tiers[0];
      return recommended.pack.id;
    });
  }, [open, tiers]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open || tiers.length === 0) return null;

  const selected =
    tiers.find((t) => t.pack.id === selectedId) ??
    tiers.find((t) => t.tier.recommended) ??
    tiers[0];
  const ctaDiscount = selected.discount;

  const claim = async () => {
    setPurchasing(true);
    setError(null);
    try {
      const res = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: selected.pack.id }),
      });
      const data = (await res.json().catch(() => null)) as
        | { paymentUrl?: string; error?: string }
        | null;
      if (!res.ok || !data?.paymentUrl) {
        throw new Error(data?.error || "Could not start checkout.");
      }
      window.location.href = data.paymentUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout.");
      setPurchasing(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="promo-offer-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-N0/70 backdrop-blur-[15px]"
      />

      <div className="relative z-10 flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-N50 shadow-2xl">
        {/* Hero band */}
        <div className="relative h-40 w-full shrink-0 sm:h-48">
          <Image
            src={PROMO_HERO_IMAGE}
            alt=""
            fill
            sizes="(min-width: 640px) 448px, 100vw"
            className="object-cover"
            priority
          />
          <div className="absolute inset-0 bg-gradient-to-t from-N50 via-N50/30 to-transparent" />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-radius-xl bg-N0/50 text-N900/80 backdrop-blur-sm transition-colors hover:bg-N0/70 hover:text-N900"
          >
            <X className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-brand-primary">
            {PROMO_COPY.eyebrow}
          </p>
          <h2
            id="promo-offer-title"
            className="mt-2 text-3xl font-bold leading-[1.05] tracking-[-0.02em] text-N900 sm:text-4xl"
          >
            {PROMO_COPY.headlinePrefix}{" "}
            <span className="text-brand-primary">{PROMO_COPY.headlinePercent}</span>{" "}
            {PROMO_COPY.headlineSuffix}
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-text-secondary">
            {PROMO_COPY.subcopy} — before{" "}
            <span className="font-semibold text-N800">
              {formatPromoDeadline()}
            </span>
            .
          </p>

          {/* Tiers */}
          <div className="mt-5 flex flex-col gap-2.5">
            {tiers.map(({ tier, pack, discount }) => {
              const total = packTotalCredits(pack);
              const active = pack.id === selected.pack.id;
              return (
                <button
                  key={pack.id}
                  type="button"
                  onClick={() => setSelectedId(pack.id)}
                  aria-pressed={active}
                  className={`flex items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                    active
                      ? "border-brand-primary/60 bg-brand-primary/[0.08]"
                      : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                  }`}
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                      active
                        ? "border-brand-primary bg-brand-primary text-text-on-solid"
                        : "border-white/25"
                    }`}
                  >
                    {active && <Check className="h-3 w-3" strokeWidth={3} />}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-N900">
                        {pack.label}
                      </span>
                      {discount > 0 && (
                        <span className="rounded-full bg-brand-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand-primary">
                          -{discount}%
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[11px] text-text-disabled">
                      {total.toLocaleString()} credits · ≈{" "}
                      {Math.floor(total / CREDITS_PER_IMAGE).toLocaleString()}{" "}
                      images ·{" "}
                      {Math.floor(total / CREDITS_PER_VIDEO).toLocaleString()}{" "}
                      videos
                    </p>
                  </div>

                  <div className="flex shrink-0 flex-col items-end leading-tight">
                    {tier.originalPriceIdr > pack.priceIdr && (
                      <span className="text-[11px] text-text-disabled line-through">
                        {formatIdr(tier.originalPriceIdr)}
                      </span>
                    )}
                    <span className="text-base font-bold text-N900">
                      {formatIdr(pack.priceIdr)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {error && (
            <p className="mt-3 text-xs font-medium text-error">{error}</p>
          )}

          <button
            type="button"
            onClick={claim}
            disabled={purchasing}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-radius-xl bg-brand-primary text-sm font-bold uppercase tracking-wide text-text-on-solid transition-colors hover:bg-brand-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {purchasing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                Claim {ctaDiscount > 0 ? `${ctaDiscount}% OFF — ` : ""}
                {selected.pack.label}
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="mt-3 text-center text-xs font-medium text-text-disabled transition-colors hover:text-text-secondary"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
