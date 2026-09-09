"use client";

import { useState } from "react";
import { Coins } from "lucide-react";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import AddCreditsModal from "@/components/AddCreditsModal";

/**
 * Credit balance control. Reads the shared CreditBalanceContext —
 * it never fetches on its own. Renders nothing when the balance is unknown
 * (unauthenticated, errored, or not yet loaded) so it can never break the
 * sidebar layout. Shows a small skeleton only while the first load is pending.
 * Click opens the Add credits checkout popup.
 */
export default function CreditBadge({
  className,
  iconClassName,
  variant = "default",
}: {
  className?: string;
  iconClassName?: string;
  variant?: "default" | "topup";
}) {
  const { balance, loading, announcedDelta } = useCreditBalance();
  const [open, setOpen] = useState(false);

  if (balance === null) {
    if (loading) {
      if (variant === "topup") {
        return <div className="h-8 w-[7.5rem] animate-pulse rounded-full bg-white/10" />;
      }
      return (
        <div
          className={
            className
              ? "h-8 w-[4.5rem] animate-pulse rounded-lg bg-white/10"
              : "h-4 w-14 animate-pulse rounded bg-white/10"
          }
        />
      );
    }
    return null;
  }

  return (
    <>
      <span className="relative inline-flex">
        {announcedDelta !== null && (
          <span
            aria-hidden
            className="animate-credit-gain-pop pointer-events-none absolute -top-1 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs font-bold text-success"
          >
            +{announcedDelta}
          </span>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setOpen(true);
          }}
          aria-label="Top up credits"
          title="Top up credits"
          className={
            (variant === "topup"
              ? "inline-flex h-8 items-center gap-1.5 rounded-full bg-O100 pl-2 pr-0.5 transition-colors hover:bg-O200"
              : (className ??
                "inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-N700 transition-colors hover:bg-white/15")) +
            (announcedDelta !== null ? " animate-credit-gain-glow" : "")
          }
        >
          {variant === "topup" ? (
            <>
              <Coins className="h-3.5 w-3.5 text-brand-primary" />
              <span className="text-sm font-bold tabular-nums text-brand-primary">{balance}</span>
              <span className="inline-flex h-7 items-center rounded-full bg-brand-primary px-2.5 text-[11px] font-bold leading-none text-text-on-solid">
                Top up
              </span>
            </>
          ) : (
            <>
              <Coins className={iconClassName ?? "h-3 w-3"} />
              {balance} credits
            </>
          )}
        </button>
      </span>
      <AddCreditsModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
