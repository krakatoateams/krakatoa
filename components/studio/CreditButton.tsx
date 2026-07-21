"use client";

import { Loader2, Wand2 } from "lucide-react";
import {
  isCreditBalanceSufficient,
  insufficientCreditsTooltip,
} from "@/lib/credit-ui";
import { Tooltip } from "./Tooltip";

// Canonical orange "Generate" button styling shared by every studio tool. Change
// the radius / gradient here once and it applies to Photo + Video everywhere.
export const GENERATE_BTN_CLASS =
  "flex h-10 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-[#f45906] px-6 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-orange-500/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40";

// Shared "Cancel" button styling used beside Generate while a job is running.
export const CANCEL_BTN_CLASS =
  "flex h-10 items-center justify-center gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-4 text-sm font-bold uppercase tracking-wide text-red-300 transition-all hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50";

// Generate/submit button with credit cost display, affordability gate, and an
// insufficient-credits tooltip. `balance === null` (unknown) never blocks — the
// server is the source of truth.
export function CreditActionButton({
  balance,
  cost,
  ready,
  loading,
  label,
  type = "submit",
  onClick,
  className = GENERATE_BTN_CLASS,
}: {
  balance: number | null;
  cost: number;
  ready: boolean;
  loading: boolean;
  label: string;
  type?: "submit" | "button";
  onClick?: () => void;
  className?: string;
}) {
  const canAfford = isCreditBalanceSufficient(balance, cost);
  const disabled = !ready || !canAfford || loading;
  const creditHint =
    ready && !canAfford ? insufficientCreditsTooltip(balance, cost) : null;

  const button = (
    <button type={type} onClick={onClick} disabled={disabled} className={className}>
      {loading ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <>
          <span>{label}</span>
          <Wand2 className="h-4 w-4" />
          <span className="text-sm font-extrabold">{cost}</span>
        </>
      )}
    </button>
  );

  if (creditHint) {
    return <Tooltip label={creditHint}>{button}</Tooltip>;
  }
  return button;
}
