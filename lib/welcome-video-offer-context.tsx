"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/auth-context";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";

export type WelcomeVideoOffer = { creditAmount: number; href: string };

type WelcomeVideoOfferContextValue = {
  offer: WelcomeVideoOffer | null;
  claiming: boolean;
  error: string | null;
  claim: () => Promise<string | null>;
};

const WelcomeVideoOfferContext = createContext<WelcomeVideoOfferContextValue>({
  offer: null,
  claiming: false,
  error: null,
  claim: async () => null,
});

/**
 * Single source of truth for the welcome-video offer, shared by
 * WelcomeVideoOfferModal (global popup) and WelcomeVideoOfferCard (fallback
 * card). One fetch instead of two, and — the part that actually matters —
 * one `offer` value both surfaces read: claiming from EITHER one nulls it
 * out here immediately, so the other disappears in the same render instead
 * of waiting for its own separate, already-fetched-once state to catch up.
 * (A real bug hit during testing: claiming via the popup left the card
 * showing, because each surface owned its own independent copy of "is there
 * an offer".)
 *
 * Each surface still keeps its OWN session-scoped "dismissed" flag locally
 * (see useWelcomeVideoOffer) — that's deliberately per-surface, not shared,
 * so closing the popup doesn't hide the card and vice versa.
 */
export function WelcomeVideoOfferProvider({ children }: { children: React.ReactNode }) {
  const { status } = useCurrentUser();
  const { refetch: refetchCreditBalance } = useCreditBalance();
  const [offer, setOffer] = useState<WelcomeVideoOffer | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") {
      setOffer(null);
      return;
    }
    let cancelled = false;
    fetch("/api/welcome-video-offer", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { eligible?: boolean; creditAmount?: number; href?: string } | null) => {
        if (cancelled) return;
        setOffer(d?.eligible && d.href ? { creditAmount: d.creditAmount ?? 0, href: d.href } : null);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status]);

  const claim = useCallback(async (): Promise<string | null> => {
    setClaiming(true);
    setError(null);
    try {
      const res = await fetch("/api/welcome-video-offer/claim", { method: "POST" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.href) {
        setError(data?.error || "Couldn't claim the offer — please try again.");
        return null;
      }
      // Hide the offer everywhere immediately — both the popup and the card
      // read this same value, so this is what actually makes claiming in
      // one surface hide the other in the same render.
      setOffer(null);
      refetchCreditBalance(typeof data.creditAmount === "number" ? data.creditAmount : undefined);
      return data.href as string;
    } catch {
      setError("Couldn't claim the offer — please try again.");
      return null;
    } finally {
      setClaiming(false);
    }
  }, [refetchCreditBalance]);

  return (
    <WelcomeVideoOfferContext.Provider value={{ offer, claiming, error, claim }}>
      {children}
    </WelcomeVideoOfferContext.Provider>
  );
}

export function useWelcomeVideoOfferContext(): WelcomeVideoOfferContextValue {
  return useContext(WelcomeVideoOfferContext);
}
