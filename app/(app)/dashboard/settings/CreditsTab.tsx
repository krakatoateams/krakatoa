"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Coins,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { DEFAULT_CREDIT_PACKS, formatIdr, type CreditPack } from "@/lib/credit-packs";

type BalanceResponse = {
  balance: number;
  lifetimePurchased: number;
  lifetimeSpent: number;
};

type ReturnBanner = {
  kind: "success" | "pending" | "failed";
  message: string;
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

// Customer-friendly names for each credit lot source.
const SOURCE_LABELS: Record<string, string> = {
  regular: "Purchased",
  purchase_bonus: "Purchase bonus",
  new_user_bonus: "Welcome bonus",
  refund: "Refund",
  adjustment: "Adjustment",
  legacy: "Credits",
};

type CreditBucket = {
  source: string;
  amount: number;
  expiresAt: string | null;
};

type CreditLotSummary = {
  buckets: CreditBucket[];
  expiringSoon: { amount: number; withinDays: number; nextExpiryAt: string | null };
  neverExpires: number;
  totalTracked: number;
};

/** Whole days from now until `iso` (rounded up; negative if past). */
function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function formatExpiry(iso: string): string {
  const date = new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
  const d = daysUntil(iso);
  const rel = d <= 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
  return `${date} · ${rel}`;
}

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
  const { balance, refetch: refetchBalance } = useCreditBalance();
  const [stats, setStats] = useState<BalanceResponse | null>(null);
  const [items, setItems] = useState<TransactionItem[]>([]);
  const [lotSummary, setLotSummary] = useState<CreditLotSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [banner, setBanner] = useState<ReturnBanner | null>(null);
  // Admin-managed tiers; seeded with the static defaults so the panel renders
  // instantly, then refreshed from the DB-backed API.
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
    // Re-pull tiers when the tab regains focus so admin price edits show up
    // without a full reload.
    const onFocus = () => loadPacks();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const loadCredits = useCallback(async () => {
    const [balanceData, txData, lotData] = await Promise.all([
      fetch("/api/credits/balance").then((r) => (r.ok ? r.json() : null)),
      fetch("/api/credits/transactions").then((r) =>
        r.ok ? r.json() : { items: [] }
      ),
      fetch("/api/credits/lots").then((r) => (r.ok ? r.json() : null)),
    ]);
    if (balanceData) setStats(balanceData as BalanceResponse);
    setItems((txData?.items as TransactionItem[]) ?? []);
    setLotSummary((lotData as CreditLotSummary | null) ?? null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    loadCredits()
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
  }, [loadCredits]);

  // Handle the post-DOKU redirect: ?status=success|failed&order=<invoice>.
  // Credits land via the webhook, so on success we poll the order a few times
  // and refresh the wallet so the badge/stats update once fulfillment lands.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const status = params.get("status");
    const order = params.get("order");
    if (!status) return;

    // Clean the URL so a refresh doesn't re-trigger the banner.
    params.delete("status");
    params.delete("order");
    const cleaned = `${window.location.pathname}${
      params.toString() ? `?${params.toString()}` : ""
    }`;
    window.history.replaceState({}, "", cleaned);

    if (status === "failed") {
      setBanner({
        kind: "failed",
        message: "Payment was not completed. You have not been charged.",
      });
      return;
    }

    if (status !== "success" || !order) return;

    let cancelled = false;
    setBanner({
      kind: "pending",
      message: "Payment received — adding credits to your balance…",
    });

    (async () => {
      for (let attempt = 0; attempt < 8 && !cancelled; attempt++) {
        try {
          const res = await fetch(
            `/api/credits/orders/${encodeURIComponent(order)}`
          );
          if (res.ok) {
            const data = (await res.json()) as { status?: string; credits?: number };
            if (data.status === "paid") {
              setBanner({
                kind: "success",
                message: `${(data.credits ?? 0).toLocaleString()} credits added to your balance.`,
              });
              await loadCredits().catch(() => {});
              refetchBalance();
              return;
            }
            if (data.status === "failed" || data.status === "expired") {
              setBanner({
                kind: "failed",
                message: "Payment did not go through. You have not been charged.",
              });
              return;
            }
          }
        } catch {
          // transient — keep polling
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
      if (!cancelled) {
        setBanner({
          kind: "pending",
          message:
            "Payment is processing. Your credits will appear shortly — refresh in a moment.",
        });
        refetchBalance();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadCredits, refetchBalance]);

  const handleBuy = useCallback(async (packId: string) => {
    setPurchasingId(packId);
    setBuyError(null);
    try {
      const res = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { paymentUrl?: string; error?: string }
        | null;
      if (!res.ok || !data?.paymentUrl) {
        throw new Error(data?.error || "Could not start checkout.");
      }
      window.location.href = data.paymentUrl;
    } catch (e) {
      setBuyError(e instanceof Error ? e.message : "Could not start checkout.");
      setPurchasingId(null);
    }
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

      {/* Credit breakdown: which credits expire, and when. */}
      {lotSummary && lotSummary.buckets.length > 0 ? (
        <div className="rounded-xl border border-gray-800 bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-800 px-5 py-3">
            <h3 className="text-sm font-semibold text-white">Credit breakdown</h3>
            <span className="text-[11px] text-gray-500">
              Earliest-expiring credits are used first
            </span>
          </div>

          <ul className="divide-y divide-gray-800">
            {lotSummary.buckets.map((b, i) => {
              const soon = b.expiresAt !== null && daysUntil(b.expiresAt) <= 30;
              return (
                <li
                  key={`${b.source}-${b.expiresAt ?? "never"}-${i}`}
                  className="flex items-center justify-between gap-4 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white">
                      {SOURCE_LABELS[b.source] ?? b.source}
                    </p>
                    <p
                      className={`flex items-center gap-1 text-[11px] ${
                        soon ? "text-amber-400" : "text-gray-500"
                      }`}
                    >
                      {b.expiresAt === null ? (
                        "Never expires"
                      ) : (
                        <>
                          <Clock className="h-3 w-3" />
                          Expires {formatExpiry(b.expiresAt)}
                        </>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-white">
                    {b.amount.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {/* Post-payment return banner */}
      {banner ? (
        <div
          className={`flex items-start gap-3 rounded-xl border p-4 text-sm ${
            banner.kind === "success"
              ? "border-green-500/30 bg-green-500/10 text-green-300"
              : banner.kind === "failed"
                ? "border-red-500/30 bg-red-500/10 text-red-300"
                : "border-violet-500/30 bg-violet-500/10 text-violet-200"
          }`}
        >
          {banner.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          ) : banner.kind === "failed" ? (
            <XCircle className="mt-0.5 h-5 w-5 shrink-0" />
          ) : (
            <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" />
          )}
          <p>{banner.message}</p>
        </div>
      ) : null}

      {/* Buy credits */}
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-violet-500/15">
            <Sparkles className="h-5 w-5 text-violet-300" />
          </div>
          <div>
            <p className="text-sm font-medium text-white">Buy credits</p>
            <p className="text-xs text-gray-500">
              Top up your balance to keep generating. Pay securely with DOKU.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {packs.map((pack) => {
            const isBusy = purchasingId === pack.id;
            const anyBusy = purchasingId !== null;
            return (
              <div
                key={pack.id}
                className={`relative flex flex-col rounded-xl border p-4 transition-colors ${
                  pack.popular
                    ? "border-violet-500/40 bg-violet-500/[0.06]"
                    : "border-gray-800 bg-gray-950"
                }`}
              >
                {pack.popular ? (
                  <span className="absolute -top-2 right-3 rounded-full bg-violet-500 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                    Popular
                  </span>
                ) : null}
                <p className="flex items-baseline gap-1.5 text-2xl font-bold text-white">
                  {pack.credits.toLocaleString()}
                  {pack.bonusCredits ? (
                    <span className="text-sm font-semibold text-emerald-400">
                      +{pack.bonusCredits.toLocaleString()}
                    </span>
                  ) : null}
                </p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-gray-500">
                  credits · {pack.label}
                </p>
                <p className="mt-3 text-sm font-semibold text-gray-200">
                  {formatIdr(pack.priceIdr)}
                </p>
                <button
                  type="button"
                  onClick={() => handleBuy(pack.id)}
                  disabled={anyBusy}
                  className={`mt-4 flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                    pack.popular
                      ? "bg-violet-500 text-white hover:bg-violet-400"
                      : "border border-gray-700 bg-gray-800 text-white hover:bg-gray-700"
                  }`}
                >
                  {isBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Redirecting…
                    </>
                  ) : (
                    "Buy"
                  )}
                </button>
              </div>
            );
          })}
        </div>

        {buyError ? (
          <p className="mt-3 text-sm text-red-400">{buyError}</p>
        ) : null}
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
