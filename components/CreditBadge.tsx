"use client";

import { Coins } from "lucide-react";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";

/**
 * Presentational credit balance pill. Reads the shared CreditBalanceContext —
 * it never fetches on its own. Renders nothing when the balance is unknown
 * (unauthenticated, errored, or not yet loaded) so it can never break the
 * sidebar layout. Shows a small skeleton only while the first load is pending.
 */
export default function CreditBadge() {
  const { balance, loading } = useCreditBalance();

  if (balance === null) {
    if (loading) {
      return <div className="h-4 w-14 animate-pulse rounded bg-gray-800" />;
    }
    return null;
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-semibold text-violet-300">
      <Coins className="h-3 w-3" />
      {balance} credits
    </span>
  );
}
