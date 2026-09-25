"use client";

import { useCallback, useEffect, useState } from "react";
import type { PackCurrency } from "@/lib/credit-packs";

const STORAGE_KEY = "krakatoa-pack-currency";

/** Shared IDR/USD choice. USD stays hidden until an admin turns checkout on. */
export function usePackCurrency(): {
  currency: PackCurrency;
  setCurrency: (next: PackCurrency) => void;
  usdEnabled: boolean;
} {
  const [currency, setCurrencyState] = useState<PackCurrency>("IDR");
  const [usdEnabled, setUsdEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/credits/usd-checkout", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((payload: { enabled?: boolean }) => {
        if (cancelled) return;
        const enabled = payload.enabled === true;
        setUsdEnabled(enabled);
        if (!enabled) {
          setCurrencyState("IDR");
          return;
        }
        const stored = window.localStorage.getItem(STORAGE_KEY);
        setCurrencyState(stored === "IDR" ? "IDR" : "USD");
      })
      .catch(() => {
        if (!cancelled) {
          setUsdEnabled(false);
          setCurrencyState("IDR");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setCurrency = useCallback((next: PackCurrency) => {
    if (next === "USD" && !usdEnabled) return;
    setCurrencyState(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  }, [usdEnabled]);

  return { currency: usdEnabled ? currency : "IDR", setCurrency, usdEnabled };
}
