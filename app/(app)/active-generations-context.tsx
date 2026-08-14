"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useCurrentUser } from "@/lib/auth-context";
import { GENERATION_CHANGED_EVENT } from "@/lib/active-generation-events";
import {
  isLiveStatus,
  type ActiveGeneration,
} from "@/lib/active-generations-pure";

type ActiveGenerationsState = {
  items: ActiveGeneration[];
  loading: boolean;
  refetch: () => void;
};

const ActiveGenerationsContext = createContext<ActiveGenerationsState>({
  items: [],
  loading: false,
  refetch: () => {},
});

const FAST_MS = 2500;
const SLOW_MS = 12_000;
const BOOST_MS = 30_000;

export function ActiveGenerationsProvider({ children }: { children: React.ReactNode }) {
  const { status } = useCurrentUser();
  const [items, setItems] = useState<ActiveGeneration[]>([]);
  const [loading, setLoading] = useState(false);
  const [boost, setBoost] = useState(false);

  const refetch = useCallback(() => {
    if (status !== "authenticated") return;
    fetch("/api/generations/active")
      .then(async (res) => {
        if (res.status === 401) return { items: [] as ActiveGeneration[] };
        if (!res.ok) throw new Error(`active generations failed (${res.status})`);
        return res.json() as Promise<{ items?: ActiveGeneration[] }>;
      })
      .then((data) => {
        setItems(Array.isArray(data.items) ? data.items : []);
      })
      .catch(() => {
        /* banner/tiles fail closed — composer still owns the in-page spinner */
      })
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => {
    if (status !== "authenticated") {
      setItems([]);
      return;
    }
    setLoading(true);
    refetch();
  }, [status, refetch]);

  const live = items.some((i) => isLiveStatus(i.status));

  useEffect(() => {
    if (status !== "authenticated") return;

    const onChanged = () => {
      setBoost(true);
      refetch();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refetch();
    };
    window.addEventListener(GENERATION_CHANGED_EVENT, onChanged);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);

    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      refetch();
    }, live || boost ? FAST_MS : SLOW_MS);

    return () => {
      clearInterval(timer);
      window.removeEventListener(GENERATION_CHANGED_EVENT, onChanged);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [status, refetch, live, boost]);

  useEffect(() => {
    if (!boost) return;
    const t = setTimeout(() => setBoost(false), BOOST_MS);
    return () => clearTimeout(t);
  }, [boost]);

  const value = useMemo(() => ({ items, loading, refetch }), [items, loading, refetch]);

  return (
    <ActiveGenerationsContext.Provider value={value}>
      {children}
    </ActiveGenerationsContext.Provider>
  );
}

export function useActiveGenerations(): ActiveGenerationsState {
  return useContext(ActiveGenerationsContext);
}
