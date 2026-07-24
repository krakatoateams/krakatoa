"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { formatIdr } from "@/lib/credit-packs";

type AdminCreditPack = {
  id: string;
  credits: number;
  bonusCredits?: number;
  priceIdr: number;
  label: string;
  popular?: boolean;
  isActive: boolean;
  sortOrder: number;
};

/** Row model — numbers held as strings for input friendliness. */
type Row = {
  id: string;
  credits: string;
  bonusCredits: string;
  priceIdr: string;
  label: string;
  popular: boolean;
  isActive: boolean;
  isNew: boolean;
};

function toRow(p: AdminCreditPack): Row {
  return {
    id: p.id,
    credits: String(p.credits),
    bonusCredits: p.bonusCredits ? String(p.bonusCredits) : "",
    priceIdr: String(p.priceIdr),
    label: p.label,
    popular: !!p.popular,
    isActive: p.isActive,
    isNew: false,
  };
}

// Cost basis rule: 100 tokens (credits) = US$1. A tier's USD cost is derived from
// its total credits (base + bonus) — shown as info, never edited.
const TOKENS_PER_USD = 100;

function costUsdLabel(credits: string, bonusCredits: string): string {
  const total = (Number(credits) || 0) + (Number(bonusCredits) || 0);
  if (total <= 0) return "—";
  return `$${(total / TOKENS_PER_USD).toFixed(2)}`;
}

/**
 * Informational economics derived from the tier's tokens, its IDR price, and the
 * admin-supplied kurs (IDR per US$1). Cost basis is 100 tokens = US$1.
 */
function economicsFor(
  credits: string,
  bonusCredits: string,
  priceIdr: string,
  kurs: string
): { sellUsd: string; margin: string; profitIdr: string; negative: boolean } {
  const total = (Number(credits) || 0) + (Number(bonusCredits) || 0);
  const price = Number(priceIdr) || 0;
  const rate = Number(kurs) || 0;
  if (total <= 0 || price <= 0 || rate <= 0) {
    return { sellUsd: "—", margin: "—", profitIdr: "—", negative: false };
  }
  const costUsd = total / TOKENS_PER_USD;
  const sellUsd = price / rate;
  // Markup on cost: profit as a percentage of the base cost (0% = sold at cost).
  const marginPct = ((sellUsd - costUsd) / costUsd) * 100;
  const profitIdr = price - costUsd * rate;
  return {
    sellUsd: `$${sellUsd.toFixed(2)}`,
    margin: `${marginPct.toFixed(0)}%`,
    profitIdr: formatIdr(Math.round(profitIdr)),
    negative: marginPct < 0,
  };
}

export default function AdminPricingPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // USD → IDR exchange rate used only for the informational economics columns.
  const [kurs, setKurs] = useState("18000");
  // Welcome bonus (new-user credit grant) config.
  const [welcomeEnabled, setWelcomeEnabled] = useState(false);
  const [welcomeAmount, setWelcomeAmount] = useState("0");
  const [welcomeBusy, setWelcomeBusy] = useState(false);
  const [welcomeMsg, setWelcomeMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/welcome-bonus", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings?: { enabled: boolean; creditAmount: number } } | null) => {
        if (cancelled || !d?.settings) return;
        setWelcomeEnabled(d.settings.enabled);
        setWelcomeAmount(String(d.settings.creditAmount));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const saveWelcome = async () => {
    setWelcomeBusy(true);
    setWelcomeMsg(null);
    try {
      const res = await fetch("/api/admin/welcome-bonus", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enabled: welcomeEnabled,
          creditAmount: Number(welcomeAmount) || 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setWelcomeEnabled(data.settings.enabled);
      setWelcomeAmount(String(data.settings.creditAmount));
      setWelcomeMsg("Welcome bonus saved.");
    } catch (e) {
      setWelcomeMsg(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setWelcomeBusy(false);
    }
  };

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/pricing")
      .then(async (res) => {
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        return res.json();
      })
      .then((d: { packs: AdminCreditPack[] }) => setRows(d.packs.map(toRow)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (index: number, changes: Partial<Row>) => {
    setRows((prev) =>
      prev ? prev.map((r, i) => (i === index ? { ...r, ...changes } : r)) : prev
    );
  };

  // Only one tier may be flagged "Popular".
  const setPopular = (index: number) => {
    setRows((prev) =>
      prev ? prev.map((r, i) => ({ ...r, popular: i === index ? !r.popular : false })) : prev
    );
  };

  const move = (index: number, dir: -1 | 1) => {
    setRows((prev) => {
      if (!prev) return prev;
      const j = index + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const remove = (index: number) => {
    setRows((prev) => (prev ? prev.filter((_, i) => i !== index) : prev));
  };

  const addTier = () => {
    setRows((prev) => [
      ...(prev ?? []),
      {
        id: "",
        credits: "",
        bonusCredits: "",
        priceIdr: "",
        label: "",
        popular: false,
        isActive: true,
        isNew: true,
      },
    ]);
  };

  const save = async () => {
    if (!rows) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const packs = rows.map((r) => ({
        id: r.id.trim(),
        credits: Number(r.credits),
        bonusCredits: r.bonusCredits === "" ? 0 : Number(r.bonusCredits),
        priceIdr: Number(r.priceIdr),
        label: r.label.trim(),
        popular: r.popular,
        isActive: r.isActive,
      }));
      const res = await fetch("/api/admin/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packs }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setRows((data.packs as AdminCreditPack[]).map(toRow));
      setNotice("Pricing tiers saved.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-sm text-gray-500">Loading…</p>;
  if (!rows) return <p className="text-sm text-red-400">{error ?? "Failed to load."}</p>;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-4 text-sm text-gray-400">
        Manage the credit purchase tiers shown on the Buy credits panel and the
        landing page. Price is in whole IDR and is charged via DOKU. The tier{" "}
        <span className="text-gray-200">id</span> is referenced by past orders, so
        it can&apos;t be changed once a tier exists — add a new tier instead.
        Inactive tiers are hidden from customers but kept for history.
      </div>

      {/* Welcome bonus — credits auto-granted to new users on sign-up. */}
      <section className="rounded-xl border border-gray-800 bg-gray-900 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Welcome bonus</h3>
            <p className="mt-1 max-w-xl text-xs text-gray-500">
              Credits automatically granted to each new user when they sign up.
              Applies to regular customers; admins always receive the internal
              test seed. Expiry follows the new-user bonus setting on the Expiry
              tab.
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={welcomeEnabled}
              onChange={(e) => {
                setWelcomeEnabled(e.target.checked);
                setWelcomeMsg(null);
              }}
              className="h-4 w-4 accent-emerald-500"
            />
            Active
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label htmlFor="welcome-amount" className="text-sm text-gray-400">
            Credit value
          </label>
          <input
            id="welcome-amount"
            type="number"
            min={0}
            value={welcomeAmount}
            onChange={(e) => {
              setWelcomeAmount(e.target.value.replace(/[^\d]/g, ""));
              setWelcomeMsg(null);
            }}
            disabled={!welcomeEnabled}
            placeholder="0"
            className="w-32 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-right text-sm text-white outline-none focus:border-violet-500 disabled:opacity-40"
          />
          <span className="text-sm text-gray-500">credits</span>
          <div className="flex-1" />
          {welcomeMsg && (
            <span
              className={`text-xs ${
                welcomeMsg.includes("saved") ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {welcomeMsg}
            </span>
          )}
          <button
            type="button"
            onClick={saveWelcome}
            disabled={welcomeBusy}
            className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
          >
            {welcomeBusy ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">
          {notice}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="kurs" className="text-sm text-gray-400">
          Kurs (IDR per US$1)
        </label>
        <input
          id="kurs"
          type="number"
          min={1}
          value={kurs}
          onChange={(e) => setKurs(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="18000"
          className="w-32 rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-right text-sm text-white outline-none focus:border-violet-500"
        />
        <span className="text-xs text-gray-600">
          Used only to compute the informational USD / margin columns.
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1240px] space-y-1.5">
          {/* Column headers (shown once). */}
          <div className="grid grid-cols-[64px_96px_1fr_84px_84px_84px_128px_84px_72px_120px_64px_64px_32px] items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <span>Order</span>
            <span>Id</span>
            <span>Label</span>
            <span className="text-right">Credits</span>
            <span className="text-right">Bonus</span>
            <span className="text-right" title="100 tokens = US$1">
              Cost (USD)
            </span>
            <span className="text-right">Price (IDR)</span>
            <span className="text-right" title="Price (IDR) ÷ kurs">
              Sell (USD)
            </span>
            <span className="text-right" title="(Sell − Cost) ÷ Cost (markup)">
              Margin
            </span>
            <span className="text-right" title="Price (IDR) − Cost (IDR)">
              Profit (IDR)
            </span>
            <span className="text-center">Popular</span>
            <span className="text-center">Active</span>
            <span />
          </div>

          {rows.map((row, i) => (
            <div
              key={`${row.id}-${i}`}
              className="grid grid-cols-[64px_96px_1fr_84px_84px_84px_128px_84px_72px_120px_64px_64px_32px] items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-2 py-1.5"
            >
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="rounded p-1 text-gray-400 transition-colors hover:text-violet-300 disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  aria-label="Move down"
                  className="rounded p-1 text-gray-400 transition-colors hover:text-violet-300 disabled:opacity-30"
                >
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </div>
              <input
                value={row.id}
                onChange={(e) => patch(i, { id: e.target.value })}
                readOnly={!row.isNew}
                placeholder="p6"
                title={row.isNew ? "Tier id" : "Id can't change once a tier exists"}
                className={`w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-white outline-none focus:border-violet-500 ${
                  !row.isNew ? "cursor-not-allowed text-gray-500" : ""
                }`}
              />
              <input
                value={row.label}
                onChange={(e) => patch(i, { label: e.target.value })}
                placeholder="Label"
                className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-sm text-white outline-none focus:border-violet-500"
              />
              <input
                type="number"
                min={1}
                value={row.credits}
                placeholder="0"
                onChange={(e) => patch(i, { credits: e.target.value.replace(/[^\d]/g, "") })}
                className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-right text-sm text-white outline-none focus:border-violet-500"
              />
              <input
                type="number"
                min={0}
                value={row.bonusCredits}
                placeholder="0"
                onChange={(e) =>
                  patch(i, { bonusCredits: e.target.value.replace(/[^\d]/g, "") })
                }
                className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-right text-sm text-white outline-none focus:border-violet-500"
              />
              <span
                title="100 tokens = US$1"
                className="px-2 text-right text-sm text-gray-400"
              >
                {costUsdLabel(row.credits, row.bonusCredits)}
              </span>
              <input
                type="number"
                min={0}
                value={row.priceIdr}
                placeholder="0"
                title={row.priceIdr ? formatIdr(Number(row.priceIdr)) : undefined}
                onChange={(e) => patch(i, { priceIdr: e.target.value.replace(/[^\d]/g, "") })}
                className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1 text-right text-sm text-white outline-none focus:border-violet-500"
              />
              {(() => {
                const eco = economicsFor(
                  row.credits,
                  row.bonusCredits,
                  row.priceIdr,
                  kurs
                );
                const tone = eco.negative ? "text-red-400" : "text-gray-400";
                return (
                  <>
                    <span className={`px-2 text-right text-sm ${tone}`}>
                      {eco.sellUsd}
                    </span>
                    <span className={`px-2 text-right text-sm ${tone}`}>
                      {eco.margin}
                    </span>
                    <span className={`px-2 text-right text-sm ${tone}`}>
                      {eco.profitIdr}
                    </span>
                  </>
                );
              })()}
              <div className="flex justify-center">
                <input
                  type="checkbox"
                  checked={row.popular}
                  onChange={() => setPopular(i)}
                  aria-label="Popular"
                  className="h-4 w-4 accent-violet-500"
                />
              </div>
              <div className="flex justify-center">
                <input
                  type="checkbox"
                  checked={row.isActive}
                  onChange={(e) => patch(i, { isActive: e.target.checked })}
                  aria-label="Active (visible to customers)"
                  className="h-4 w-4 accent-emerald-500"
                />
              </div>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label="Remove tier"
                className="flex justify-center rounded p-1 text-gray-400 transition-colors hover:text-red-300"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={addTier}
          className="flex items-center gap-1.5 rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-violet-500 hover:text-violet-300"
        >
          <Plus className="h-4 w-4" />
          Add tier
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        <button
          type="button"
          onClick={load}
          disabled={saving}
          className="text-sm text-gray-400 transition-colors hover:text-white disabled:opacity-50"
        >
          Reset
        </button>
      </div>

      <p className="text-xs text-gray-600">
        Removing a tier only deletes the offer — historical orders and granted
        credits are unaffected. Changes apply within ~a minute (cached), or
        immediately for new checkouts.
      </p>
    </div>
  );
}

