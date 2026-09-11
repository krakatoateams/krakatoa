"use client";

import { useRouter } from "next/navigation";
import { Gift, X } from "lucide-react";
import { useWelcomeVideoOffer } from "@/lib/use-welcome-video-offer";

const DISMISS_KEY_PREFIX = "welcomeVideoOffer:dismissed:";

/**
 * "Claim your free video" fallback card, living in the video generation tool
 * (the /dashboard Skills composer) so the offer is never fully lost even for
 * a visitor who closed WelcomeVideoOfferModal (the global popup) without
 * claiming, or who signed up from a completely different entry point (e.g.
 * Schedule) and was correctly returned there instead of being redirected
 * into video generation. Independent dismiss state from the modal on
 * purpose: closing one must not hide the other.
 */
export default function WelcomeVideoOfferCard() {
  const router = useRouter();
  const { offer, dismiss, claim, claiming, error } = useWelcomeVideoOffer(DISMISS_KEY_PREFIX);

  if (!offer) return null;

  const handleClaim = async () => {
    const href = await claim();
    if (!href) return;
    dismiss();
    router.push(href, { scroll: true });
  };

  return (
    <div className="animate-pop-in relative mb-6 flex items-center gap-4 overflow-hidden rounded-radius-xl border border-brand-primary/30 bg-gradient-to-r from-brand-primary/15 via-brand-primary/10 to-transparent px-spacing-lg py-spacing-md">
      <div
        aria-hidden
        className="absolute -left-6 -top-10 h-24 w-24 rounded-full bg-brand-primary/25 blur-3xl"
      />
      <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-primary-hover shadow-md shadow-brand-primary/30">
        <Gift className="h-5 w-5 text-white" strokeWidth={1.75} />
      </div>
      <div className="relative min-w-0 flex-1">
        <p className="text-body-3 font-semibold text-text-primary">Claim your free video generation</p>
        <p className="text-small text-text-secondary">
          {error ?? "On us. We picked a model, just hit Generate."}
        </p>
      </div>
      <button
        type="button"
        onClick={handleClaim}
        disabled={claiming}
        className="relative shrink-0 rounded-radius-lg bg-gradient-to-r from-brand-primary to-brand-primary-hover px-4 py-2 text-body-3 font-semibold text-white shadow-sm shadow-brand-primary/25 transition-transform hover:scale-[1.03] active:scale-[0.97] disabled:opacity-60 disabled:hover:scale-100"
      >
        {claiming ? "Claiming…" : "Claim it"}
      </button>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss"
        className="relative shrink-0 rounded-radius-lg p-1.5 text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-text-primary"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
