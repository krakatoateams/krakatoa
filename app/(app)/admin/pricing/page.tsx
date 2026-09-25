"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Eye, Plus, Trash2 } from "lucide-react";
import { formatIdr } from "@/lib/credit-packs";
import { MAX_WELCOME_BONUS_CREDITS } from "@/lib/welcome-bonus-validation";
import PromoOfferModal from "@/components/PromoOfferModal";

type AdminCreditPack = {
  id: string;
  credits: number;
  bonusCredits?: number;
  priceIdr: number;
  priceUsdCents: number;
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
  priceUsd: string;
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
    priceUsd: (p.priceUsdCents / 100).toFixed(2),
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
 * Informational economics. Cost basis is 100 tokens = US$1.
 * Sell USD / Margin USD use the USD price. Sell IDR / Margin IDR use the IDR
 * price, with cost converted at the admin kurs (IDR per US$1).
 */
function economicsFor(
  credits: string,
  bonusCredits: string,
  priceIdr: string,
  priceUsd: string,
  kurs: string
): {
  sellUsd: string;
  sellIdr: string;
  marginUsd: string;
  marginIdr: string;
  usdNegative: boolean;
  idrNegative: boolean;
} {
  const empty = {
    sellUsd: "—",
    sellIdr: "—",
    marginUsd: "—",
    marginIdr: "—",
    usdNegative: false,
    idrNegative: false,
  };
  const total = (Number(credits) || 0) + (Number(bonusCredits) || 0);
  const idr = Number(priceIdr) || 0;
  const usd = Number(priceUsd) || 0;
  const rate = Number(kurs) || 0;
  if (total <= 0) return empty;
  const costUsd = total / TOKENS_PER_USD;
  const marginPct = (sell: number, cost: number) => ((sell - cost) / cost) * 100;
  const usdMargin = usd > 0 ? marginPct(usd, costUsd) : null;
  const idrMargin = idr > 0 && rate > 0 ? marginPct(idr, costUsd * rate) : null;
  return {
    sellUsd: usd > 0 ? `$${usd.toFixed(2)}` : "—",
    sellIdr: idr > 0 ? formatIdr(idr) : "—",
    marginUsd: usdMargin === null ? "—" : `${usdMargin.toFixed(0)}%`,
    marginIdr: idrMargin === null ? "—" : `${idrMargin.toFixed(0)}%`,
    usdNegative: usdMargin !== null && usdMargin < 0,
    idrNegative: idrMargin !== null && idrMargin < 0,
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
  // Welcome offer (promo popup) config.
  const [offerEnabled, setOfferEnabled] = useState(false);
  const [offerBusy, setOfferBusy] = useState(false);
  const [offerMsg, setOfferMsg] = useState<string | null>(null);
  const [usdCheckoutEnabled, setUsdCheckoutEnabled] = useState(false);
  const [usdCheckoutBusy, setUsdCheckoutBusy] = useState(false);
  const [usdCheckoutMsg, setUsdCheckoutMsg] = useState<string | null>(null);
  const [offerPreview, setOfferPreview] = useState(false);

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

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/welcome-offer", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings?: { enabled: boolean } } | null) => {
        if (cancelled || !d?.settings) return;
        setOfferEnabled(d.settings.enabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/usd-checkout", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { settings?: { enabled: boolean } } | null) => {
        if (cancelled || !d?.settings) return;
        setUsdCheckoutEnabled(d.settings.enabled);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const saveUsdCheckout = async (enabled: boolean) => {
    setUsdCheckoutBusy(true);
    setUsdCheckoutMsg(null);
    setUsdCheckoutEnabled(enabled);
    try {
      const res = await fetch("/api/admin/usd-checkout", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Could not save.");
      setUsdCheckoutMsg(enabled ? "USD checkout is visible." : "USD checkout is hidden.");
    } catch (e) {
      setUsdCheckoutEnabled(!enabled);
      setUsdCheckoutMsg(e instanceof Error ? e.message : "Could not save.");
    } finally {
      setUsdCheckoutBusy(false);
    }
  };

  const saveOffer = async () => {
    setOfferBusy(true);
    setOfferMsg(null);
    try {
      const res = await fetch("/api/admin/welcome-offer", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: offerEnabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      setOfferEnabled(data.settings.enabled);
      setOfferMsg("Welcome offer saved.");
    } catch (e) {
      setOfferMsg(e instanceof Error ? e.message : "Failed to save.");
    } finally {
      setOfferBusy(false);
    }
  };

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
        priceUsd: "",
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
        priceUsdCents: Math.round(Number(r.priceUsd || 0) * 100),
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
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 text-sm text-gray-400">
        Manage the credit purchase tiers shown on the Buy credits panel and the
        landing page. Price (IDR) is charged via DOKU. Price (USD) is the dummy
        amount customers see when they pick USD; Polar does not charge it yet.
        The tier <span className="text-gray-200">id</span> is referenced by past orders, so
        it can&apos;t be changed once a tier exists — add a new tier instead.
        Inactive tiers are hidden from customers but kept for history.
      </div>

      <section className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">USD checkout</h3>
            <p className="mt-1 max-w-xl text-xs text-gray-500">
              Hides the USD price toggle and blocks USD purchases. IDR checkout
              through DOKU stays available. Turn this on when a USD processor is ready.
            </p>
            {usdCheckoutMsg ? (
              <p className="mt-2 text-xs text-gray-300">{usdCheckoutMsg}</p>
            ) : null}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={usdCheckoutEnabled}
              disabled={usdCheckoutBusy}
              onChange={(e) => void saveUsdCheckout(e.target.checked)}
              className="h-4 w-4 accent-emerald-500"
            />
            Show USD
          </label>
        </div>
      </section>

      {/* Welcome offer — the promo popup shown once per session on the dashboard. */}
      <section className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Welcome offer</h3>
            <p className="mt-1 max-w-xl text-xs text-gray-500">
              Master switch for the limited-time promo popup shown once per
              session to signed-in users on the dashboard. Purely marketing —
              the Claim button still charges the real, server-authoritative pack
              price. Copy, deadline, and tiers live in{" "}
              <span className="text-gray-200">lib/promo-offer.ts</span>.
            </p>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-300">
            <input
              type="checkbox"
              checked={offerEnabled}
              onChange={(e) => {
                setOfferEnabled(e.target.checked);
                setOfferMsg(null);
              }}
              className="h-4 w-4 accent-emerald-500"
            />
            Active
          </label>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setOfferPreview(true)}
            className="flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-white/30 hover:text-white"
          >
            <Eye className="h-4 w-4" />
            Preview
          </button>
          <div className="flex-1" />
          {offerMsg && (
            <span
              className={`text-xs ${
                offerMsg.includes("saved") ? "text-emerald-400" : "text-red-400"
              }`}
            >
              {offerMsg}
            </span>
          )}
          <button
            type="button"
            onClick={saveOffer}
            disabled={offerBusy}
            className="rounded-md bg-[#F26522] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#e05a1a] disabled:opacity-50"
          >
            {offerBusy ? "Saving…" : "Save"}
          </button>
        </div>
      </section>

      <PromoOfferModal open={offerPreview} onClose={() => setOfferPreview(false)} />

      {/* Welcome bonus — credits granted when an eligible user claims the offer. */}
      <section className="rounded-xl border border-white/10 bg-white/[0.04] p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold text-white">Welcome bonus</h3>
            <p className="mt-1 max-w-xl text-xs text-gray-500">
              Credits granted when an eligible new user claims the welcome-video
              offer. Admins receive the separate internal test seed. Expiry
              follows the new-user bonus setting on the Expiry tab.
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
            max={MAX_WELCOME_BONUS_CREDITS}
            value={welcomeAmount}
            onChange={(e) => {
              setWelcomeAmount(e.target.value.replace(/[^\d]/g, ""));
              setWelcomeMsg(null);
            }}
            disabled={!welcomeEnabled}
            placeholder="0"
            className="w-32 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-right text-sm text-white outline-none focus:border-white/30 disabled:opacity-40"
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
            className="rounded-md bg-[#F26522] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#e05a1a] disabled:opacity-50"
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
          className="w-32 rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-right text-sm text-white outline-none focus:border-white/30"
        />
        <span className="text-xs text-gray-600">
          Converts the token cost into IDR for Sell (IDR) and Margin (IDR).
        </span>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[1480px] space-y-1.5">
          {/* Column headers (shown once). */}
          <div className="grid grid-cols-[64px_96px_1fr_84px_84px_84px_128px_112px_84px_120px_80px_80px_64px_64px_32px] items-center gap-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            <span>Order</span>
            <span>Id</span>
            <span>Label</span>
            <span className="text-right">Credits</span>
            <span className="text-right">Bonus</span>
            <span className="text-right" title="100 tokens = US$1">
              Cost (USD)
            </span>
            <span className="text-right">Price (IDR)</span>
            <span className="text-right">Price (USD)</span>
            <span className="text-right" title="The USD price charged for this pack">
              Sell (USD)
            </span>
            <span className="text-right" title="The IDR price charged for this pack">
              Sell (IDR)
            </span>
            <span className="text-right" title="(Sell USD − Cost USD) ÷ Cost USD">
              Margin (USD)
            </span>
            <span className="text-right" title="(Sell IDR − Cost USD × kurs) ÷ (Cost USD × kurs)">
              Margin (IDR)
            </span>
            <span className="text-center">Popular</span>
            <span className="text-center">Active</span>
            <span />
          </div>

          {rows.map((row, i) => (
            <div
              key={`${row.id}-${i}`}
              className="grid grid-cols-[64px_96px_1fr_84px_84px_84px_128px_112px_84px_120px_80px_80px_64px_64px_32px] items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5"
            >
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label="Move up"
                  className="rounded p-1 text-gray-400 transition-colors hover:text-white disabled:opacity-30"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === rows.length - 1}
                  aria-label="Move down"
                  className="rounded p-1 text-gray-400 transition-colors hover:text-white disabled:opacity-30"
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
                className={`w-full rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-sm text-white outline-none focus:border-white/30 ${
                  !row.isNew ? "cursor-not-allowed text-gray-500" : ""
                }`}
              />
              <input
                value={row.label}
                onChange={(e) => patch(i, { label: e.target.value })}
                placeholder="Label"
                className="w-full rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-sm text-white outline-none focus:border-white/30"
              />
              <input
                type="number"
                min={1}
                value={row.credits}
                placeholder="0"
                onChange={(e) => patch(i, { credits: e.target.value.replace(/[^\d]/g, "") })}
                className="w-full rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-right text-sm text-white outline-none focus:border-white/30"
              />
              <input
                type="number"
                min={0}
                value={row.bonusCredits}
                placeholder="0"
                onChange={(e) =>
                  patch(i, { bonusCredits: e.target.value.replace(/[^\d]/g, "") })
                }
                className="w-full rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-right text-sm text-white outline-none focus:border-white/30"
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
                className="w-full rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-right text-sm text-white outline-none focus:border-white/30"
              />
              <input
                inputMode="decimal"
                value={row.priceUsd}
                placeholder="0.00"
                title="Customer-facing USD price"
                onChange={(e) => patch(i, { priceUsd: e.target.value.replace(/[^\d.]/g, "") })}
                className="w-full rounded-md border border-white/10 bg-white/[0.02] px-2 py-1 text-right text-sm text-white outline-none focus:border-white/30"
              />
              {(() => {
                const eco = economicsFor(
                  row.credits,
                  row.bonusCredits,
                  row.priceIdr,
                  row.priceUsd,
                  kurs
                );
                const usdTone = eco.usdNegative ? "text-red-400" : "text-gray-400";
                const idrTone = eco.idrNegative ? "text-red-400" : "text-gray-400";
                return (
                  <>
                    <span className={`px-2 text-right text-sm ${usdTone}`}>{eco.sellUsd}</span>
                    <span className={`px-2 text-right text-sm ${idrTone}`}>{eco.sellIdr}</span>
                    <span className={`px-2 text-right text-sm ${usdTone}`}>{eco.marginUsd}</span>
                    <span className={`px-2 text-right text-sm ${idrTone}`}>{eco.marginIdr}</span>
                  </>
                );
              })()}
              <div className="flex justify-center">
                <input
                  type="checkbox"
                  checked={row.popular}
                  onChange={() => setPopular(i)}
                  aria-label="Popular"
                  className="h-4 w-4 accent-white"
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
          className="flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-2 text-sm text-gray-300 transition-colors hover:border-white/30 hover:text-white"
        >
          <Plus className="h-4 w-4" />
          Add tier
        </button>
        <div className="flex-1" />
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-[#F26522] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#e05a1a] disabled:opacity-50"
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
        credits are unaffected. Pack changes apply immediately to new checkouts;
        welcome toggles may take up to a minute across running instances.
      </p>
    </div>
  );
}

