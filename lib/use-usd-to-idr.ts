"use client";

import { useEffect, useState } from "react";

let cached: number | null | undefined;
let pending: Promise<number | null> | null = null;

function loadUsdToIdr(): Promise<number | null> {
  if (cached !== undefined) return Promise.resolve(cached);
  if (!pending) {
    pending = fetch("/api/credits/fx", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { usdToIdr?: unknown } | null) => {
        const rate = typeof data?.usdToIdr === "number" ? data.usdToIdr : null;
        cached = rate != null && Number.isFinite(rate) && rate > 0 ? rate : null;
        return cached;
      })
      .catch(() => {
        cached = null;
        return null;
      });
  }
  return pending;
}

/** Admin billing rate (IDR per 1 USD). Null until loaded, or when the rate is unusable. */
export function useUsdToIdr(): number | null {
  const [rate, setRate] = useState<number | null>(cached && cached > 0 ? cached : null);

  useEffect(() => {
    let cancelled = false;
    void loadUsdToIdr().then((next) => {
      if (!cancelled) setRate(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return rate;
}
