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

type NotificationsState = {
  unreadCount: number;
  /** Re-read the badge count now. */
  refreshCount: () => void;
  /** Optimistically clear the badge after the panel marks everything read. */
  clearUnread: () => void;
};

const NotificationsContext = createContext<NotificationsState>({
  unreadCount: 0,
  refreshCount: () => {},
  clearUnread: () => {},
});

/** Badge refresh cadence while the tab is visible. */
const POLL_MS = 60_000;

/**
 * One shared unread count for every bell on screen (desktop sidebar and the
 * mobile header are both mounted, only one is visible). Polls lightly — on
 * mount, when the tab becomes visible again, and every minute while visible —
 * instead of a realtime channel, to keep Supabase egress low.
 */
export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { status } = useCurrentUser();
  const [unreadCount, setUnreadCount] = useState(0);
  const authenticated = status === "authenticated";

  const refreshCount = useCallback(() => {
    fetch("/api/notifications/unread-count", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { count?: number } | null) => {
        if (body && typeof body.count === "number") setUnreadCount(body.count);
      })
      .catch(() => {
        /* keep the last known count; the next tick retries */
      });
  }, []);

  const clearUnread = useCallback(() => setUnreadCount(0), []);

  useEffect(() => {
    if (!authenticated) {
      setUnreadCount(0);
      return;
    }
    refreshCount();

    const onVisible = () => {
      if (document.visibilityState === "visible") refreshCount();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") refreshCount();
    }, POLL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [authenticated, refreshCount]);

  const value = useMemo(
    () => ({ unreadCount, refreshCount, clearUnread }),
    [unreadCount, refreshCount, clearUnread],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsState {
  return useContext(NotificationsContext);
}
