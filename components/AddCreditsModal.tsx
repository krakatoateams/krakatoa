"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Sparkles, X } from "lucide-react";
import { useCreditPacks } from "@/lib/use-credit-packs";
import { formatIdr, type CreditPack } from "@/lib/credit-packs";

export default function AddCreditsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const packs = useCreditPacks();
  const [purchasingId, setPurchasingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !purchasingId) onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, purchasingId]);

  const buy = async (pack: CreditPack) => {
    setPurchasingId(pack.id);
    setError(null);
    try {
      const res = await fetch("/api/credits/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ packId: pack.id }),
      });
      const data = (await res.json().catch(() => null)) as
        | { paymentUrl?: string; error?: string }
        | null;
      if (!res.ok || !data?.paymentUrl) {
        throw new Error(data?.error || "Could not start checkout.");
      }
      window.location.href = data.paymentUrl;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start checkout.");
      setPurchasingId(null);
    }
  };

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-credits-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      <div
        aria-hidden
        onClick={() => {
          if (!purchasingId) onClose();
        }}
        className="absolute inset-0 bg-N0/70 backdrop-blur-sm"
      />
      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-white/10 bg-N50 p-5 shadow-2xl shadow-N0/50">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/10">
              <Sparkles className="h-5 w-5 text-N700" />
            </div>
            <div>
              <h2 id="add-credits-title" className="text-lg font-semibold text-N900">
                Add credits
              </h2>
              <p className="mt-0.5 text-sm text-text-secondary">
                Top up your balance. Pay securely with DOKU.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={Boolean(purchasingId)}
            aria-label="Close"
            className="rounded-lg p-1.5 text-text-secondary hover:bg-white/10 hover:text-N900 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {packs.map((pack) => {
            const busy = purchasingId === pack.id;
            const anyBusy = purchasingId !== null;
            return (
              <button
                key={pack.id}
                type="button"
                onClick={() => buy(pack)}
                disabled={anyBusy}
                className={`relative flex flex-col rounded-xl border p-4 text-left transition-colors disabled:opacity-50 ${
                  pack.popular
                    ? "border-white/30 bg-white/[0.06] hover:bg-white/[0.09]"
                    : "border-white/10 bg-white/[0.02] hover:bg-white/[0.06]"
                }`}
              >
                {pack.popular ? (
                  <span className="absolute -top-2 right-3 rounded-full bg-bg-static-white px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-text-static-black">
                    Popular
                  </span>
                ) : null}
                <p className="flex items-baseline gap-1.5 text-xl font-bold text-N900">
                  {pack.credits.toLocaleString()}
                  {pack.bonusCredits ? (
                    <span className="text-xs font-semibold text-success">
                      +{pack.bonusCredits.toLocaleString()}
                    </span>
                  ) : null}
                </p>
                <p className="text-[11px] font-medium uppercase tracking-wider text-text-disabled">
                  {pack.label}
                </p>
                <p className="mt-2 text-sm font-semibold text-N700">{formatIdr(pack.priceIdr)}</p>
                <span className="mt-3 inline-flex h-8 items-center justify-center rounded-lg bg-white/10 text-xs font-semibold text-N900">
                  {busy ? (
                    <>
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                      Redirecting…
                    </>
                  ) : (
                    "Buy"
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {error ? <p className="mt-3 text-sm text-error">{error}</p> : null}
      </div>
    </div>,
    document.body
  );
}
