"use client";

import { useEffect, useState } from "react";
import { DEFAULT_CREDIT_PACKS, type CreditPack } from "./credit-packs";

/**
 * Admin-managed credit tiers for the public pricing sections. Seeded with the
 * static defaults, then refreshed from the public packs API — the defaults
 * stand in if the fetch fails, so pricing always renders something.
 *
 * Re-fetches when the tab regains focus so admin price edits show up without a
 * hard reload.
 */
export function useCreditPacks(): CreditPack[] {
  const [packs, setPacks] = useState<CreditPack[]>(DEFAULT_CREDIT_PACKS);

  useEffect(() => {
    let cancelled = false;
    const loadPacks = () => {
      fetch("/api/credits/packs", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { packs?: CreditPack[] } | null) => {
          if (!cancelled && d?.packs?.length) setPacks(d.packs);
        })
        .catch(() => {});
    };
    loadPacks();
    const onFocus = () => loadPacks();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  return packs;
}
