"use client";

import type { PackCurrency } from "@/lib/credit-packs";
import { usePackCurrency } from "@/lib/use-pack-currency";

export function PackCurrencyToggle({
  currency,
  onChange,
}: {
  currency?: PackCurrency;
  onChange?: (next: PackCurrency) => void;
}) {
  const stored = usePackCurrency();
  const current = currency ?? stored.currency;
  const setCurrency = onChange ?? stored.setCurrency;
  const usdEnabled = stored.usdEnabled;

  if (!usdEnabled) return null;

  return (
    <div className="inline-flex items-center rounded-lg border border-white/10 bg-white/[0.04] p-0.5">
      {(["USD", "IDR"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={current === value}
          onClick={() => setCurrency(value)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-semibold tracking-wide ${
            current === value
              ? "bg-bg-static-white text-text-static-black"
              : "text-text-disabled hover:text-N700"
          }`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}
