"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Gift, Sparkles, X } from "lucide-react";
import { useCurrentUser } from "@/lib/auth-context";
import { useWelcomeVideoOffer } from "@/lib/use-welcome-video-offer";
import type { WelcomeVideoOffer } from "@/lib/welcome-video-offer-context";

const SHOWN_KEY_PREFIX = "welcomeVideoOfferModal:shown:";

/**
 * Global, one-time "Welcome, {name}! Here's a free video on us" popup,
 * mounted once in the (app) shell (see app/(app)/layout.tsx) so it fires
 * regardless of which page a new user lands on after signup (e.g. Schedule,
 * not just /dashboard). Claiming navigates straight into the pre-filled
 * generation and pops a "+N" callout on the sidebar credit badge (see
 * CreditBadge + credit-balance-context's announcedDelta), so the eye follows
 * where the credits actually landed. Closing it does NOT navigate and does
 * NOT dismiss WelcomeVideoOfferCard (the fallback card living in the video
 * tool): the two share the underlying offer state (claiming in either one
 * hides both, see WelcomeVideoOfferProvider) but keep independent "did I
 * personally close this" flags, so the offer isn't lost if someone closes
 * this without claiming.
 *
 * Shows at most once per browser session per account (own sessionStorage key
 * namespace, separate from the card's), not on every page navigation while
 * still eligible.
 */
export default function WelcomeVideoOfferModal() {
  const { name } = useCurrentUser();
  const router = useRouter();
  const { offer, dismiss, claim, claiming, error } = useWelcomeVideoOffer(SHOWN_KEY_PREFIX);
  const [shownOffer, setShownOffer] = useState<WelcomeVideoOffer | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!offer || shownOffer) return;
    setShownOffer(offer);
    setOpen(true);
    // Mark "shown" immediately, not only on close: a page navigation right
    // after this fires shouldn't re-trigger the popup again this session.
    dismiss();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer, shownOffer]);

  if (!open || !shownOffer) return null;

  const firstName = name?.split(" ")[0];

  const handleClaim = async () => {
    const href = await claim();
    if (!href) return;
    setOpen(false);
    router.push(href, { scroll: true });
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-video-offer-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      <div
        aria-hidden
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-N0/75 backdrop-blur-xl"
      />
      <div className="animate-pop-in relative z-10 w-full max-w-sm overflow-hidden rounded-[28px] border border-white/10 bg-N50 shadow-2xl">
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close"
          className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-full bg-N0/20 text-icon-low-emphasis backdrop-blur-sm transition-colors hover:bg-N0/40 hover:text-text-primary"
        >
          <X className="h-4 w-4" strokeWidth={2.25} />
        </button>

        {/* Gift banner: a glowing blob behind a bouncing gift icon, not a
            plain flat credit-amount line. */}
        <div className="relative flex flex-col items-center gap-2 overflow-hidden bg-gradient-to-b from-brand-primary/30 via-brand-primary/10 to-transparent px-6 pb-6 pt-10 text-center">
          <div
            aria-hidden
            className="absolute left-1/2 top-6 h-28 w-28 -translate-x-1/2 rounded-full bg-brand-primary/40 blur-3xl"
          />
          <Sparkles className="absolute left-7 top-8 h-4 w-4 text-brand-primary/60" />
          <Sparkles className="absolute right-9 top-14 h-3 w-3 text-brand-primary/50" />
          <Sparkles className="absolute right-14 top-6 h-2.5 w-2.5 text-brand-primary/40" />
          <div className="animate-gift-bounce relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-full bg-gradient-to-br from-brand-primary to-brand-primary-hover shadow-lg shadow-brand-primary/40">
            <Gift className="h-9 w-9 text-white" strokeWidth={1.75} />
          </div>
          <p className="relative mt-1 text-2xl font-black leading-tight text-brand-primary">
            Free Video Generation
          </p>
          <p className="relative text-xs font-bold uppercase tracking-[0.15em] text-brand-primary/80">
            Just for you
          </p>
        </div>

        <div className="px-6 pb-6 pt-5 text-center">
          <h2 id="welcome-video-offer-title" className="text-xl font-bold text-text-primary">
            Welcome{firstName ? `, ${firstName}` : ""}! 🎉
          </h2>
          <p className="mt-1.5 text-body-3 text-text-secondary">
            {error ??
              "This one's on us. We already picked a model and a scene, so you just click Generate."}
          </p>

          <button
            type="button"
            onClick={handleClaim}
            disabled={claiming}
            className="mt-5 w-full rounded-radius-lg bg-gradient-to-r from-brand-primary to-brand-primary-hover px-4 py-2.5 text-body-3 font-semibold text-white shadow-md shadow-brand-primary/30 transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-60 disabled:hover:scale-100"
          >
            {claiming ? "Claiming…" : "Claim my free video generation"}
          </button>
        </div>
      </div>
    </div>
  );
}
