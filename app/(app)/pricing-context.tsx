"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  PRODUCT_PHOTO_CREDITS,
  STORYBOARD_IMAGE_CREDITS,
  STORYBOARD_VIDEO_CREDITS,
  VIDEO_CREDITS_PER_SECOND,
} from "@/lib/credit-costs";

/**
 * Client-side effective pricing cache for cost labels. Mirrors the
 * CreditBalanceProvider pattern: fetches once on mount, no polling, and fails
 * silently. When the fetch fails or is pending, consumers get the canonical
 * constants from lib/credit-costs.ts so labels never show NaN/0 or break.
 *
 * Holds NO balance, transaction, payment, or secret data.
 */

export type EffectivePricing = {
  seedanceRatePerSecond: number;
  veoRatePerSecond: number;
  storyboardImage: number;
  storyboardVideo: number;
  productPhoto: number;
};

const FALLBACK_PRICING: EffectivePricing = {
  seedanceRatePerSecond: VIDEO_CREDITS_PER_SECOND,
  veoRatePerSecond: VIDEO_CREDITS_PER_SECOND,
  storyboardImage: STORYBOARD_IMAGE_CREDITS,
  storyboardVideo: STORYBOARD_VIDEO_CREDITS,
  productPhoto: PRODUCT_PHOTO_CREDITS,
};

type PricingState = {
  // Always non-null: real values once loaded, canonical constants otherwise.
  pricing: EffectivePricing;
  loading: boolean;
};

const PricingContext = createContext<PricingState>({
  pricing: FALLBACK_PRICING,
  loading: false,
});

function isValidNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

/** Coerce an API payload into a complete EffectivePricing, filling gaps with fallback. */
function normalize(raw: Partial<EffectivePricing> | undefined): EffectivePricing {
  if (!raw) return FALLBACK_PRICING;
  return {
    seedanceRatePerSecond: isValidNumber(raw.seedanceRatePerSecond)
      ? raw.seedanceRatePerSecond
      : FALLBACK_PRICING.seedanceRatePerSecond,
    veoRatePerSecond: isValidNumber(raw.veoRatePerSecond)
      ? raw.veoRatePerSecond
      : FALLBACK_PRICING.veoRatePerSecond,
    storyboardImage: isValidNumber(raw.storyboardImage)
      ? raw.storyboardImage
      : FALLBACK_PRICING.storyboardImage,
    storyboardVideo: isValidNumber(raw.storyboardVideo)
      ? raw.storyboardVideo
      : FALLBACK_PRICING.storyboardVideo,
    productPhoto: isValidNumber(raw.productPhoto)
      ? raw.productPhoto
      : FALLBACK_PRICING.productPhoto,
  };
}

export function PricingProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [pricing, setPricing] = useState<EffectivePricing>(FALLBACK_PRICING);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/credits/pricing")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { pricing?: Partial<EffectivePricing> } | null) => {
        if (cancelled) return;
        setPricing(normalize(data?.pricing));
      })
      .catch(() => {
        // Fail silent: keep fallback constants.
        if (!cancelled) setPricing(FALLBACK_PRICING);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  return (
    <PricingContext.Provider value={{ pricing, loading }}>
      {children}
    </PricingContext.Provider>
  );
}

export function usePricing(): PricingState {
  return useContext(PricingContext);
}
