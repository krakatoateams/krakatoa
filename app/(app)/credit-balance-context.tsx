"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { useCurrentUser } from "@/lib/auth-context";

type CreditBalanceState = {
  balance: number | null;
  loading: boolean;
  error: string | null;
  refetch: (announceDelta?: number) => void;
  /**
   * A positive amount just credited (e.g. the welcome-video claim), cleared
   * automatically ~2s after being set. Consumers (CreditBadge) use the
   * transition from null -> N -> null to drive a one-off "+N" callout
   * without owning any timer themselves.
   */
  announcedDelta: number | null;
};

const CreditBalanceContext = createContext<CreditBalanceState>({
  balance: null,
  loading: false,
  error: null,
  refetch: () => {},
  announcedDelta: null,
});

const ANNOUNCE_MS = 2200;

/**
 * Tiny client-side wallet cache. Fetches the balance once on mount (and again
 * when a tool flow calls `refetch()` after a successful generation). No polling,
 * no global event bus. It fails silently: a failed/unauthenticated fetch leaves
 * `balance` null so the layout/sidebar never breaks — the badge simply hides.
 */
export function CreditBalanceProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useCurrentUser();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcedDelta, setAnnouncedDelta] = useState<number | null>(null);
  const announceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(
    (announceDelta?: number) => {
      // Only fetch for an authenticated session — skip otherwise so we never
      // surface a 401 as a user-visible error.
      if (status !== "authenticated") return;
      if (announceDelta && announceDelta > 0) {
        setAnnouncedDelta(announceDelta);
        if (announceTimer.current) clearTimeout(announceTimer.current);
        announceTimer.current = setTimeout(() => setAnnouncedDelta(null), ANNOUNCE_MS);
      }
      setLoading(true);
      setError(null);
      fetch("/api/credits/balance")
        .then(async (res) => {
          if (!res.ok) throw new Error(`Balance request failed (${res.status})`);
          return res.json();
        })
        .then((data: { balance?: number }) => {
          setBalance(typeof data.balance === "number" ? data.balance : null);
        })
        .catch((e: unknown) => {
          setError(e instanceof Error ? e.message : "Failed to load balance.");
          setBalance(null);
        })
        .finally(() => setLoading(false));
    },
    [status]
  );

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    return () => {
      if (announceTimer.current) clearTimeout(announceTimer.current);
    };
  }, []);

  return (
    <CreditBalanceContext.Provider value={{ balance, loading, error, refetch, announcedDelta }}>
      {children}
    </CreditBalanceContext.Provider>
  );
}

export function useCreditBalance(): CreditBalanceState {
  return useContext(CreditBalanceContext);
}
