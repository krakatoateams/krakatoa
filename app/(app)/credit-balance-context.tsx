"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { useSession } from "next-auth/react";

type CreditBalanceState = {
  balance: number | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
};

const CreditBalanceContext = createContext<CreditBalanceState>({
  balance: null,
  loading: false,
  error: null,
  refetch: () => {},
});

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
  const { status } = useSession();
  const [balance, setBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(() => {
    // Only fetch for an authenticated session — skip otherwise so we never
    // surface a 401 as a user-visible error.
    if (status !== "authenticated") return;
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
  }, [status]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return (
    <CreditBalanceContext.Provider value={{ balance, loading, error, refetch }}>
      {children}
    </CreditBalanceContext.Provider>
  );
}

export function useCreditBalance(): CreditBalanceState {
  return useContext(CreditBalanceContext);
}
