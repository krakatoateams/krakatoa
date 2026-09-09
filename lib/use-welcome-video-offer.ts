"use client";

import { useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/auth-context";
import { useWelcomeVideoOfferContext } from "@/lib/welcome-video-offer-context";

/**
 * Per-surface view onto the shared WelcomeVideoOfferProvider: the real
 * offer/claim state is shared (see that context — claiming from either
 * surface hides both), but each surface keeps its OWN session-scoped
 * "dismissed" flag, keyed by the signed-in user's own id. Deliberately
 * per-surface, not shared: closing the popup must not hide the fallback
 * card, and vice versa.
 */
export function useWelcomeVideoOffer(dismissKeyPrefix: string) {
  const { user } = useCurrentUser();
  const { offer, claiming, error, claim } = useWelcomeVideoOfferContext();
  const [dismissed, setDismissed] = useState(false);

  const dismissKey = user?.id ? `${dismissKeyPrefix}${user.id}` : null;

  useEffect(() => {
    if (!dismissKey) {
      setDismissed(false);
      return;
    }
    try {
      setDismissed(sessionStorage.getItem(dismissKey) === "1");
    } catch {
      setDismissed(false);
    }
  }, [dismissKey]);

  const dismiss = () => {
    try {
      if (dismissKey) sessionStorage.setItem(dismissKey, "1");
    } catch {
      // ignore — private browsing etc.
    }
    setDismissed(true);
  };

  return {
    offer: dismissed ? null : offer,
    dismiss,
    claim,
    claiming,
    error,
  };
}
