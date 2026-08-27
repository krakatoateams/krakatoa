"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import {
  formatIdr,
  packBonusValueIdr,
  packTotalCredits,
  type CreditPack,
} from "@/lib/credit-packs";
import { useCreditPacks } from "@/lib/use-credit-packs";
import {
  CREDITS_PER_IMAGE,
  CREDITS_PER_VIDEO,
  CREDIT_CTA_HREF_AUTHED,
  CREDIT_POLICY,
  PLANS,
  PRICING_ASIDE,
  PRICING_HEADING,
  PRICING_SUBHEADING,
  SHOW_PLANS,
  type Plan,
} from "@/lib/landing-content";
import { eyebrow, heading, panel } from "./theme";

type Mode = "plans" | "credits";

function CheckBullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[14px] leading-relaxed text-text-secondary">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-white/10">
        <Check className="h-3 w-3 text-N700" strokeWidth={2.5} />
      </span>
      <span>{children}</span>
    </li>
  );
}

const CREDIT_ROW_CLASSNAME =
  "group flex w-full items-center gap-4 px-5 py-5 text-left transition-colors hover:bg-white/[0.03] sm:gap-6 sm:px-6";

function CreditRow({
  pack,
  authed,
  onGuestClick,
}: {
  pack: CreditPack;
  authed: boolean;
  onGuestClick: () => void;
}) {
  const total = packTotalCredits(pack);
  const label = `Purchase ${pack.credits.toLocaleString()} credits (${pack.label}) for ${formatIdr(pack.priceIdr)}`;
  const content = <CreditRowContent pack={pack} total={total} />;

  // Guests never leave the page — clicking "Purchase" opens the sign-in
  // modal instead of navigating to /login, same as the nav CTA.
  if (!authed) {
    return (
      <button type="button" onClick={onGuestClick} aria-label={label} className={CREDIT_ROW_CLASSNAME}>
        {content}
      </button>
    );
  }

  return (
    <a href={CREDIT_CTA_HREF_AUTHED} aria-label={label} className={CREDIT_ROW_CLASSNAME}>
      {content}
    </a>
  );
}

function CreditRowContent({ pack, total }: { pack: CreditPack; total: number }) {
  return (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="font-medium leading-none tracking-[-0.02em] text-N900"
            style={{ fontSize: "clamp(1.375rem, 2.2vw, 1.75rem)" }}
          >
            {pack.credits.toLocaleString()}
          </span>
          {pack.bonusCredits ? (
            <span className="text-[13px] font-medium text-N700">
              +{pack.bonusCredits.toLocaleString()} credits
            </span>
          ) : null}
          {pack.popular && (
            <span className="rounded bg-bg-static-white px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-text-static-black">
              Most popular
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[12px] text-text-disabled">
          ≈ {Math.floor(total / CREDITS_PER_IMAGE).toLocaleString()} images ·{" "}
          {Math.floor(total / CREDITS_PER_VIDEO).toLocaleString()} videos
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3 sm:gap-5">
        <div className="flex flex-col items-end leading-tight">
          <span className="text-base font-medium text-N900 sm:text-lg">
            {formatIdr(pack.priceIdr)}
          </span>
          {pack.bonusCredits ? (
            <span className="text-[11px] font-medium text-text-disabled">
              Saved {formatIdr(packBonusValueIdr(pack))}
            </span>
          ) : null}
        </div>
        <span
          className={`rounded-radius-xl px-4 py-2 text-xs font-medium transition-colors sm:text-sm ${
            pack.popular
              ? "bg-brand-primary text-text-on-solid group-hover:bg-brand-primary-hover"
              : "bg-bg-static-white text-text-static-black group-hover:bg-N800"
          }`}
        >
          Purchase
        </span>
      </div>
    </>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div
      className={`flex h-full flex-col p-7 sm:p-8 ${panel} ${
        plan.featured ? "bg-N100" : ""
      }`}
    >
      <p className={eyebrow}>{plan.name}</p>
      <div className="mt-4 flex items-baseline gap-1">
        <span
          className="font-medium leading-none tracking-[-0.03em] text-N900"
          style={{ fontSize: "clamp(2.25rem, 4.5vw, 3.25rem)" }}
        >
          {plan.price}
        </span>
        <span className="text-sm font-medium text-text-disabled">
          {plan.cadence}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-text-disabled">
        {plan.tagline}
      </p>
      <div className="my-6 border-t border-white/10" />
      <ul className="mb-8 flex flex-col gap-3">
        {plan.features.map((feature) => (
          <CheckBullet key={feature}>{feature}</CheckBullet>
        ))}
      </ul>
      <a
        href={plan.ctaHref}
        className="mt-auto inline-flex items-center justify-center rounded-radius-xl bg-bg-static-white px-5 py-2.5 text-sm font-medium text-text-static-black transition-colors hover:bg-N800"
      >
        {plan.ctaLabel}
      </a>
    </div>
  );
}

function ModeToggle({
  mode,
  onChange,
}: {
  mode: Mode;
  onChange: (mode: Mode) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Pricing model"
      className="inline-flex items-center gap-1 rounded-radius-xl border border-white/10 bg-N50 p-1.5"
    >
      {(["plans", "credits"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          aria-controls="hello-pricing-grid"
          onClick={() => onChange(value)}
          className={`rounded-radius-xl px-6 py-2 text-sm font-medium capitalize transition-colors ${
            mode === value
              ? "bg-bg-static-white text-text-static-black"
              : "text-text-disabled hover:text-N700"
          }`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

export function HelloPricing() {
  const [mode, setMode] = useState<Mode>(SHOW_PLANS ? "plans" : "credits");
  const [policyOpen, setPolicyOpen] = useState(false);
  const packs = useCreditPacks();
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const isAuthed = status === "authenticated";

  return (
    <section
      id="pricing"
      className="bg-N0 pt-16 pb-16 sm:pt-20 sm:pb-20 lg:pt-28 lg:pb-28"
    >
      <div className="mx-auto max-w-[1440px]">
        <div className="px-5 sm:px-8 lg:px-12">
          <span className={eyebrow}>Pricing</span>
          <h2
            className={`mt-5 max-w-3xl ${heading}`}
            style={{ fontSize: "clamp(1.75rem, 5vw, 3rem)" }}
          >
            {PRICING_HEADING}
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-text-disabled sm:text-base">
            {PRICING_SUBHEADING}
          </p>
        </div>

        {SHOW_PLANS && (
          <div className="mt-8 flex justify-center px-5 sm:mt-10 sm:px-8 lg:px-12">
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
        )}

        <div
          id="hello-pricing-grid"
          className="mt-10 px-5 sm:mt-14 sm:px-8 lg:mt-16 lg:px-12"
        >
          {SHOW_PLANS && mode === "plans" ? (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              {PLANS.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-5 lg:items-stretch">
              <aside
                className={`flex flex-col p-6 sm:p-8 lg:col-span-2 lg:h-full ${panel}`}
              >
                <h3
                  className="font-display font-medium leading-[1.12] tracking-[-0.02em] text-N900"
                  style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)" }}
                >
                  {PRICING_ASIDE.heading}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-text-disabled">
                  {PRICING_ASIDE.body}
                </p>

                <ul className="mt-6 flex flex-col gap-3">
                  {PRICING_ASIDE.bullets.map((f) => (
                    <CheckBullet key={f}>{f}</CheckBullet>
                  ))}
                </ul>

                <p className="mt-6 text-[12px] text-text-disabled">
                  {PRICING_ASIDE.rateNote}
                </p>
                <p className="mt-auto pt-6 text-[12px] leading-relaxed text-N300">
                  {PRICING_ASIDE.disclaimer}{" "}
                  <button
                    type="button"
                    onClick={() => setPolicyOpen(true)}
                    className="font-medium text-N700 underline-offset-2 hover:text-N900 hover:underline"
                  >
                    {PRICING_ASIDE.policyLinkLabel}
                  </button>
                </p>
              </aside>

              <div
                className={`divide-y divide-white/10 overflow-hidden lg:col-span-3 ${panel}`}
              >
                {packs.map((pack) => (
                  <CreditRow
                    key={pack.id}
                    pack={pack}
                    authed={isAuthed}
                    // Landing-page exception: land signed-in visitors on the
                    // dashboard, not back on the landing page they came from.
                    onGuestClick={() => openSignInModal("/dashboard")}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <CreditPolicyModal
        open={policyOpen}
        onClose={() => setPolicyOpen(false)}
      />
    </section>
  );
}

function CreditPolicyModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="hello-credits-policy-title"
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
    >
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-N0/70 backdrop-blur-[15px]"
      />

      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl bg-N50">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 p-6">
          <h3
            id="hello-credits-policy-title"
            className="font-display text-lg font-medium tracking-[-0.01em] text-N900"
          >
            {CREDIT_POLICY.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-text-disabled transition-colors hover:bg-white/[0.06] hover:text-N900"
          >
            <X className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>

        <ul className="flex flex-col gap-3 p-6">
          {CREDIT_POLICY.items.map((item) => (
            <CheckBullet key={item}>{item}</CheckBullet>
          ))}
        </ul>

        <div className="flex justify-end border-t border-white/10 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-radius-xl bg-bg-static-white px-5 py-2 text-sm font-medium text-text-static-black transition-colors hover:bg-N800"
          >
            {CREDIT_POLICY.dismissLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
