"use client";

import { useEffect, useState } from "react";

/** Poll cancel eligibility while a long-running generation fetch is open. */
export function useGenerationStatusPoll(activeKey: string | null) {
  const [cancelAllowed, setCancelAllowed] = useState(true);
  const [phase, setPhase] = useState<string | null>(null);

  useEffect(() => {
    if (!activeKey) {
      setCancelAllowed(true);
      setPhase(null);
      return;
    }

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch("/api/generations/status", {
          headers: { "Idempotency-Key": activeKey },
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (typeof data.cancelAllowed === "boolean") {
          setCancelAllowed(data.cancelAllowed);
        }
        if (typeof data.phase === "string") {
          setPhase(data.phase);
        } else if (data.phase === null) {
          setPhase(null);
        }
      } catch {
        /* best-effort */
      }
    };

    poll();
    const interval = setInterval(poll, 2500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeKey]);

  return { cancelAllowed, phase };
}
