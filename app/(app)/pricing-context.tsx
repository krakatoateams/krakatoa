"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  PRODUCT_PHOTO_CREDITS,
  STORYBOARD_IMAGE_CREDITS,
  STORYBOARD_VIDEO_CREDITS,
  VIDEO_CREDITS_PER_SECOND,
} from "@/lib/credit-costs";
import {
  type BillingSettings,
  type CostUnit,
  type PricingRow,
  DEFAULT_BILLING_SETTINGS,
  normalizeBillingSettings,
  videoCreditsFromRow,
  imageCreditsFromRow,
  runCreditsFromRow,
} from "@/lib/pricing-math";

/**
 * Client-side effective pricing cache for cost labels (Pricing Config v2.1).
 * Fetches once on mount (no polling) and fails silently. Exposes the billing
 * settings + the public v2 config rows so labels are computed with the SAME
 * lib/pricing-math.ts the server bills with — preventing FE/BE drift. When the
 * fetch fails/pending, helpers fall back to the canonical credit-costs constants
 * so labels never show NaN/0.
 *
 * Holds NO balance, transaction, payment, or secret data.
 */

export type PublicPricingConfig = {
  pricingKey: string;
  displayName: string;
  pricingType: "fixed" | "per_second" | "per_image";
  creditAmount: number;
  enabled: boolean;
  providerCostUsd: number | null;
  costUnit: CostUnit | null;
  pricingGroup: string | null;
  variantKey: string | null;
  currency: string;
};

// Legacy snapshot kept as the ultimate fallback for known tools.
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
  billingSettings: BillingSettings;
  configs: Record<string, PublicPricingConfig>;
  pricing: EffectivePricing;
  loading: boolean;
  /** Credits for a per-second video tier over a TOTAL duration (single final ceil). */
  videoCredits: (pricingKey: string, durationSec: number, fallbackRatePerSecond?: number) => number;
  /** Credits for a per-image tier over an image count. */
  imageCredits: (pricingKey: string, imageCount: number, fallbackPerImage?: number) => number;
  /** Generic dispatch by the tier's cost unit. */
  creditsFor: (pricingKey: string, unitCount: number) => number;
};

function isValidNumber(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0;
}

function normalizePricing(raw: Partial<EffectivePricing> | undefined): EffectivePricing {
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

function toConfigMap(raw: unknown): Record<string, PublicPricingConfig> {
  const map: Record<string, PublicPricingConfig> = {};
  if (!Array.isArray(raw)) return map;
  for (const item of raw as PublicPricingConfig[]) {
    if (item && typeof item.pricingKey === "string") map[item.pricingKey] = item;
  }
  return map;
}

function toRow(cfg: PublicPricingConfig | undefined): PricingRow | null {
  if (!cfg) return null;
  return {
    providerCostUsd:
      typeof cfg.providerCostUsd === "number" && Number.isFinite(cfg.providerCostUsd)
        ? cfg.providerCostUsd
        : null,
    costUnit: cfg.costUnit ?? null,
    creditAmount:
      typeof cfg.creditAmount === "number" && Number.isFinite(cfg.creditAmount)
        ? cfg.creditAmount
        : null,
    enabled: Boolean(cfg.enabled),
  };
}

const DEFAULT_STATE: PricingState = {
  billingSettings: DEFAULT_BILLING_SETTINGS,
  configs: {},
  pricing: FALLBACK_PRICING,
  loading: false,
  videoCredits: (_k, durationSec, fallbackRatePerSecond) =>
    videoCreditsFromRow(null, durationSec, DEFAULT_BILLING_SETTINGS, fallbackRatePerSecond),
  imageCredits: (_k, imageCount, fallbackPerImage) =>
    imageCreditsFromRow(null, imageCount, DEFAULT_BILLING_SETTINGS, fallbackPerImage ?? 0),
  creditsFor: () => 0,
};

const PricingContext = createContext<PricingState>(DEFAULT_STATE);

export function PricingProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [billingSettings, setBillingSettings] = useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [configs, setConfigs] = useState<Record<string, PublicPricingConfig>>({});
  const [pricing, setPricing] = useState<EffectivePricing>(FALLBACK_PRICING);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (status !== "authenticated") return;
    let cancelled = false;
    setLoading(true);
    fetch("/api/credits/pricing")
      .then((res) => (res.ok ? res.json() : null))
      .then(
        (
          data:
            | {
                billingSettings?: Partial<BillingSettings>;
                configs?: unknown;
                pricing?: Partial<EffectivePricing>;
              }
            | null
        ) => {
          if (cancelled) return;
          setBillingSettings(normalizeBillingSettings(data?.billingSettings));
          setConfigs(toConfigMap(data?.configs));
          setPricing(normalizePricing(data?.pricing));
        }
      )
      .catch(() => {
        if (!cancelled) {
          setBillingSettings(DEFAULT_BILLING_SETTINGS);
          setConfigs({});
          setPricing(FALLBACK_PRICING);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [status]);

  const value = useMemo<PricingState>(() => {
    const videoCredits = (
      pricingKey: string,
      durationSec: number,
      fallbackRatePerSecond: number = VIDEO_CREDITS_PER_SECOND
    ): number =>
      videoCreditsFromRow(toRow(configs[pricingKey]), durationSec, billingSettings, fallbackRatePerSecond);

    const imageCredits = (
      pricingKey: string,
      imageCount: number,
      fallbackPerImage: number = 0
    ): number =>
      imageCreditsFromRow(toRow(configs[pricingKey]), imageCount, billingSettings, fallbackPerImage);

    const creditsFor = (pricingKey: string, unitCount: number): number => {
      const cfg = configs[pricingKey];
      const row = toRow(cfg);
      if (cfg?.costUnit === "per_second") {
        return videoCreditsFromRow(row, unitCount, billingSettings, VIDEO_CREDITS_PER_SECOND);
      }
      if (cfg?.costUnit === "per_run") {
        return runCreditsFromRow(row, billingSettings, cfg?.creditAmount ?? 0);
      }
      return imageCreditsFromRow(row, unitCount, billingSettings, cfg?.creditAmount ?? 0);
    };

    return { billingSettings, configs, pricing, loading, videoCredits, imageCredits, creditsFor };
  }, [billingSettings, configs, pricing, loading]);

  return <PricingContext.Provider value={value}>{children}</PricingContext.Provider>;
}

export function usePricing(): PricingState {
  return useContext(PricingContext);
}
