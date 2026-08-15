"use client";

import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/Button";
import PromoOfferModal from "@/components/PromoOfferModal";
import { PROMO_TIERS, isPromoLive } from "@/lib/promo-offer";

export default function PromoOfferPage() {
  const [open, setOpen] = useState(false);

  return (
    <section className="space-y-spacing-xxl">
      <header>
        <h1 className="font-display text-h1 font-bold">Welcome Offer</h1>
        <p className="mt-spacing-sm text-body-3 text-text-secondary">
          The limited-time promo popup (<code className="text-body-3">components/PromoOfferModal</code>)
          shown once per session to authenticated users on the dashboard. It is presentational
          marketing over the existing credit packs — a cosmetic struck-through &ldquo;original&rdquo;
          price and a &ldquo;% OFF&rdquo; badge — but the CTA drives the unchanged, server-authoritative
          DOKU checkout for the selected pack. Copy, deadline, hero image, and tiers live in{" "}
          <code className="text-body-3">lib/promo-offer.ts</code>. The preview below is the real
          component; clicking Claim will start a live checkout.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-spacing-lg rounded-radius-lg border border-border-default bg-bg-surface p-spacing-xxl">
        <Button variant="primary" size="lg" icon={Sparkles} onClick={() => setOpen(true)}>
          Open preview
        </Button>
        <p className="text-body-3 text-text-secondary">
          {PROMO_TIERS.length} tier{PROMO_TIERS.length === 1 ? "" : "s"} configured ·{" "}
          {isPromoLive() ? "Promo is live" : "Promo has ended / disabled"}
        </p>
      </div>

      <PromoOfferModal open={open} onClose={() => setOpen(false)} />
    </section>
  );
}
