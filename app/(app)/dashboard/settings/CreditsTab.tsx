"use client";

import { useEffect, useState } from "react";
import { Coins, Loader2, Sparkles } from "lucide-react";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";

type BalanceResponse = {
  balance: number;
  lifetimePurchased: number;
  lifetimeSpent: number;
};

type TransactionItem = {
  id: string;
  amount: number;
  direction: "credit" | "debit";
  type: string;
  status: string;
  description: string | null;
  created_at: string;
};

const TYPE_LABELS: Record<string, string> = {
  purchase: "Purchase",
  spend: "Spend",
  refund: "Refund",
  bonus: "Bonus",
  adjustment: "Adjustment",
  expiry: "Expiry",
};

function StatCard({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 p-4">
      <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold text-white">
        {value === null ? "—" : value.toLocaleString()}
      </p>
    </div>
  );
}

export default function CreditsTab() {
  const { balance } = useCreditBalance();
  const [stats, setStats] = useState<BalanceResponse | null>(null);
  const [items, setItems] = useState<TransactionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch("/api/credits/balance").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/credits/transactions").then((r) =>
        r.ok ? r.json() : { items: [] }
      ),
    ])
      .then(([balanceData, txData]) => {
        if (cancelled) return;
        if (balanceData) setStats(balanceData as BalanceResponse);
        setItems((txData?.items as TransactionItem[]) ?? []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load credits.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const currentBalance = stats?.balance ?? balance;

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-lg font-semibold text-white">Credits</h2>
        <p className="mt-1 text-sm text-gray-500">
          Your balance, lifetime usage, and transaction history.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Balance" value={currentBalance} />
        <StatCard label="Lifetime purchased" value={stats?.lifetimePurchased ?? null} />
        <StatCard label="Lifetime spent" value={stats?.lifetimeSpent ?? null} />
      </div>

      {/* Buy credits — Coming soon stub */}
      <div className="flex flex-col gap-3 rounded-xl border border-gray-800 bg-gray-900 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/15">
            <Sparkles className="h-5 w-5 text-violet-300" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Buy credits</p>
            <p className="text-xs text-gray-500">
              Top up your balance to keep generating.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled
          className="cursor-not-allowed rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-500"
        >
          Coming soon
        </button>
      </div>

      {/* Transaction history */}
      <div className="rounded-xl border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-5 py-3">
          <h3 className="text-sm font-semibold text-white">Transaction history</h3>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12 text-gray-500">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : error ? (
          <p className="px-5 py-8 text-center text-sm text-amber-400/90">{error}</p>
        ) : items.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <Coins className="mx-auto mb-3 h-8 w-8 text-gray-600" />
            <p className="text-sm text-gray-500">No transactions yet.</p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-800">
            {items.map((tx) => {
              const isCredit = tx.direction === "credit";
              return (
                <li
                  key={tx.id}
                  className="flex items-center justify-between gap-4 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {TYPE_LABELS[tx.type] ?? tx.type}
                      {tx.description ? (
                        <span className="font-normal text-gray-500">
                          {" "}
                          · {tx.description}
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-gray-500">
                      {new Date(tx.created_at).toLocaleString()}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-sm font-semibold ${
                      isCredit ? "text-green-400" : "text-gray-300"
                    }`}
                  >
                    {isCredit ? "+" : "−"}
                    {Math.abs(tx.amount).toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
