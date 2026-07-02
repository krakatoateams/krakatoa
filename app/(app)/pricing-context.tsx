"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "@/lib/auth-context";
import {
  type BillingSettings,
  type CostUnit,
  DEFAULT_BILLING_SETTINGS,
  normalizeBillingSettings,
  calculateCredits,
} from "@/lib/pricing-math";
import { V2_PRICING_DEFAULTS } from "@/lib/pricing-defaults";

/**
 * Client-side pricing cache for cost labels (Pricing Config v2.2).
 *
 * Fetches once on mount (no polling) and fails silently. Exposes the billing
 * settings + the PRIMARY v2 provider-cost configs so labels are computed with the
 * SAME lib/pricing-math.ts the server bills with — preventing FE/BE drift.
 *
 * Fallback model (matches the server resolver exactly): for any pricing key not
 * present in the fetched configs (fetch pending/failed, or a brand-new key), the
 * client uses the typed built-in v2 defaults (lib/pricing-defaults.ts) — NOT the
 * old legacy numbers. So labels never show NaN and never undercharge.
 *
 * Holds NO balance, transaction, payment, or secret data.
 */

export type PublicPricingConfig = {
  pricingKey: string;
  displayName: string;
  pricingType: "fixed" | "per_second" | "per_image";
  enabled: boolean;
  providerCostUsd: number | null;
  costUnit: CostUnit | null;
  pricingGroup: string | null;
  variantKey: string | null;
  currency: string;
  computedCreditsPreview: number;
  isPrimaryRuntimePrice: true;
};

type PricingState = {
  billingSettings: BillingSettings;
  configs: Record<string, PublicPricingConfig>;
  loading: boolean;
  /** Credits for a per-second video tier over a TOTAL duration (single final ceil). Floors at 1. */
  videoCredits: (pricingKey: string, durationSec: number) => number;
  /** Credits for a per-image tier over an image count. */
  imageCredits: (pricingKey: string, imageCount: number) => number;
  /** Generic dispatch by the tier's cost unit (per_second → video, else image). */
  creditsFor: (pricingKey: string, unitCount: number) => number;
};

function toConfigMap(raw: unknown): Record<string, PublicPricingConfig> {
  const map: Record<string, PublicPricingConfig> = {};
  if (!Array.isArray(raw)) return map;
  for (const item of raw as PublicPricingConfig[]) {
    if (item && typeof item.pricingKey === "string") map[item.pricingKey] = item;
  }
  return map;
}

/**
 * Provider USD cost + cost unit for a pricing key: fetched v2 config first, then
 * the built-in v2 default. Returns null only for an unknown key (should not
 * happen for any key the UI uses).
 */
function resolveCost(
  configs: Record<string, PublicPricingConfig>,
  pricingKey: string
): { providerCostUsd: number; costUnit: CostUnit } | null {
  const cfg = configs[pricingKey];
  if (cfg && typeof cfg.providerCostUsd === "number" && Number.isFinite(cfg.providerCostUsd) && cfg.costUnit) {
    return { providerCostUsd: cfg.providerCostUsd, costUnit: cfg.costUnit };
  }
  const def = V2_PRICING_DEFAULTS[pricingKey];
  if (def) return { providerCostUsd: def.providerCostUsd, costUnit: def.costUnit };
  return null;
}

const DEFAULT_STATE: PricingState = {
  billingSettings: DEFAULT_BILLING_SETTINGS,
  configs: {},
  loading: false,
  videoCredits: (pricingKey, durationSec) => {
    const c = resolveCost({}, pricingKey);
    if (!c) return 1;
    return Math.max(
      1,
      calculateCredits({ providerCostUsd: c.providerCostUsd, unitCount: durationSec, settings: DEFAULT_BILLING_SETTINGS })
    );
  },
  imageCredits: (pricingKey, imageCount) => {
    const c = resolveCost({}, pricingKey);
    if (!c) return 0;
    return calculateCredits({ providerCostUsd: c.providerCostUsd, unitCount: imageCount, settings: DEFAULT_BILLING_SETTINGS });
  },
  creditsFor: () => 0,
};

const PricingContext = createContext<PricingState>(DEFAULT_STATE);

export function PricingProvider({ children }: { children: React.ReactNode }) {
  const { status } = useCurrentUser();
  const [billingSettings, setBillingSettings] = useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [configs, setConfigs] = useState<Record<string, PublicPricingConfig>>({});
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
            | { billingSettings?: Partial<BillingSettings>; configs?: unknown }
            | null
        ) => {
          if (cancelled) return;
          setBillingSettings(normalizeBillingSettings(data?.billingSettings));
          setConfigs(toConfigMap(data?.configs));
        }
      )
      .catch(() => {
        if (!cancelled) {
          setBillingSettings(DEFAULT_BILLING_SETTINGS);
          setConfigs({});
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
    const videoCredits = (pricingKey: string, durationSec: number): number => {
      const c = resolveCost(configs, pricingKey);
      if (!c) return 1; // video is never zero-cost; unknown key should not happen
      return Math.max(
        1,
        calculateCredits({ providerCostUsd: c.providerCostUsd, unitCount: durationSec, settings: billingSettings })
      );
    };

    const imageCredits = (pricingKey: string, imageCount: number): number => {
      const c = resolveCost(configs, pricingKey);
      if (!c) return 0;
      return calculateCredits({ providerCostUsd: c.providerCostUsd, unitCount: imageCount, settings: billingSettings });
    };

    const creditsFor = (pricingKey: string, unitCount: number): number => {
      const c = resolveCost(configs, pricingKey);
      if (!c) return 0;
      return c.costUnit === "per_second"
        ? videoCredits(pricingKey, unitCount)
        : imageCredits(pricingKey, unitCount);
    };

    return { billingSettings, configs, loading, videoCredits, imageCredits, creditsFor };
  }, [billingSettings, configs, loading]);

  return <PricingContext.Provider value={value}>{children}</PricingContext.Provider>;
}

export function usePricing(): PricingState {
  return useContext(PricingContext);
}
