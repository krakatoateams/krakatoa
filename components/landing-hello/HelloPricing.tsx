"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { useCurrentUser } from "@/lib/auth-context";
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
  CREDIT_CTA_HREF_GUEST,
  CREDIT_POLICY,
  PLANS,
  PRICING_ASIDE,
  PRICING_HEADING,
  PRICING_SUBHEADING,
  SHOW_PLANS,
  type Plan,
} from "@/lib/landing-content";
import { eyebrow, panel } from "./theme";

type Mode = "plans" | "credits";

function CheckBullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-[14px] leading-relaxed text-[#aaaaaa]">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[#2a2a2a]">
        <Check className="h-3 w-3 text-[#cccccc]" strokeWidth={2.5} />
      </span>
      <span>{children}</span>
    </li>
  );
}

function CreditRow({ pack, href }: { pack: CreditPack; href: string }) {
  const total = packTotalCredits(pack);

  return (
    <a
      href={href}
      aria-label={`Purchase ${pack.credits.toLocaleString()} credits (${pack.label}) for ${formatIdr(pack.priceIdr)}`}
      className="group flex items-center gap-4 px-5 py-5 transition-colors hover:bg-white/[0.03] sm:gap-6 sm:px-6"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="font-medium leading-none tracking-[-0.02em] text-white"
            style={{ fontSize: "clamp(1.375rem, 2.2vw, 1.75rem)" }}
          >
            {pack.credits.toLocaleString()}
          </span>
          {pack.bonusCredits ? (
            <span className="text-[13px] font-medium text-[#cccccc]">
              +{pack.bonusCredits.toLocaleString()} credits
            </span>
          ) : null}
          {pack.popular && (
            <span className="rounded bg-[#fafafa] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-[#111111]">
              Most popular
            </span>
          )}
        </div>
        <p className="mt-1.5 text-[12px] text-[#8a8a8a]">
          ≈ {Math.floor(total / CREDITS_PER_IMAGE).toLocaleString()} images ·{" "}
          {Math.floor(total / CREDITS_PER_VIDEO).toLocaleString()} videos
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3 sm:gap-5">
        <div className="flex flex-col items-end leading-tight">
          <span className="text-base font-medium text-white sm:text-lg">
            {formatIdr(pack.priceIdr)}
          </span>
          {pack.bonusCredits ? (
            <span className="text-[11px] font-medium text-[#8a8a8a]">
              Saved {formatIdr(packBonusValueIdr(pack))}
            </span>
          ) : null}
        </div>
        <span
          className={`rounded-full px-4 py-2 text-xs font-medium transition-colors sm:text-sm ${
            pack.popular
              ? "bg-[#f97316] text-white group-hover:bg-[#ea580c]"
              : "bg-[#fafafa] text-[#111111] group-hover:bg-[#e0e0e0]"
          }`}
        >
          Purchase
        </span>
      </div>
    </a>
  );
}

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div
      className={`flex h-full flex-col p-7 sm:p-8 ${panel} ${
        plan.featured ? "bg-[#1d1d1d]" : ""
      }`}
    >
      <p className={eyebrow}>{plan.name}</p>
      <div className="mt-4 flex items-baseline gap-1">
        <span
          className="font-medium leading-none tracking-[-0.03em] text-white"
          style={{ fontSize: "clamp(2.25rem, 4.5vw, 3.25rem)" }}
        >
          {plan.price}
        </span>
        <span className="text-sm font-medium text-[#8a8a8a]">
          {plan.cadence}
        </span>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-[#8a8a8a]">
        {plan.tagline}
      </p>
      <div className="my-6 border-t border-[#2a2a2a]" />
      <ul className="mb-8 flex flex-col gap-3">
        {plan.features.map((feature) => (
          <CheckBullet key={feature}>{feature}</CheckBullet>
        ))}
      </ul>
      <a
        href={plan.ctaHref}
        className="mt-auto inline-flex items-center justify-center rounded-full bg-[#fafafa] px-5 py-2.5 text-sm font-medium text-[#111111] transition-colors hover:bg-[#e0e0e0]"
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
      className="inline-flex items-center gap-1 rounded-full border border-[#2a2a2a] bg-[#171717] p-1.5"
    >
      {(["plans", "credits"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          aria-controls="hello-pricing-grid"
          onClick={() => onChange(value)}
          className={`rounded-full px-6 py-2 text-sm font-medium capitalize transition-colors ${
            mode === value
              ? "bg-[#fafafa] text-[#111111]"
              : "text-[#8a8a8a] hover:text-[#cccccc]"
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

  const creditHref =
    status === "authenticated"
      ? CREDIT_CTA_HREF_AUTHED
      : CREDIT_CTA_HREF_GUEST;

  return (
    <section
      id="pricing"
      className="bg-[#0a0a0a] pt-16 pb-16 sm:pt-20 sm:pb-20 lg:pt-28 lg:pb-28"
    >
      <div className="mx-auto max-w-[1440px]">
        <div className="px-5 sm:px-8 lg:px-12">
          <span className={eyebrow}>Pricing</span>
          <h2
            className="mt-5 max-w-3xl font-medium leading-[1.08] tracking-[-0.02em] text-white"
            style={{ fontSize: "clamp(1.75rem, 5vw, 3rem)" }}
          >
            {PRICING_HEADING}
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-[#8a8a8a] sm:text-base">
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
                  className="font-medium leading-[1.12] tracking-[-0.02em] text-white"
                  style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)" }}
                >
                  {PRICING_ASIDE.heading}
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-[#8a8a8a]">
                  {PRICING_ASIDE.body}
                </p>

                <ul className="mt-6 flex flex-col gap-3">
                  {PRICING_ASIDE.bullets.map((f) => (
                    <CheckBullet key={f}>{f}</CheckBullet>
                  ))}
                </ul>

                <p className="mt-6 text-[12px] text-[#8a8a8a]">
                  {PRICING_ASIDE.rateNote}
                </p>
                <p className="mt-auto pt-6 text-[12px] leading-relaxed text-[#6f6f6f]">
                  {PRICING_ASIDE.disclaimer}{" "}
                  <button
                    type="button"
                    onClick={() => setPolicyOpen(true)}
                    className="font-medium text-[#cccccc] underline-offset-2 hover:text-white hover:underline"
                  >
                    {PRICING_ASIDE.policyLinkLabel}
                  </button>
                </p>
              </aside>

              <div
                className={`divide-y divide-[#2a2a2a] overflow-hidden lg:col-span-3 ${panel}`}
              >
                {packs.map((pack) => (
                  <CreditRow key={pack.id} pack={pack} href={creditHref} />
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
        className="absolute inset-0 bg-black/70 backdrop-blur-[15px]"
      />

      <div className="relative z-10 w-full max-w-md overflow-hidden rounded-xl bg-[#171717]">
        <div className="flex items-start justify-between gap-4 border-b border-[#2a2a2a] p-6">
          <h3
            id="hello-credits-policy-title"
            className="text-lg font-medium tracking-[-0.01em] text-white"
          >
            {CREDIT_POLICY.title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#8a8a8a] transition-colors hover:bg-white/[0.06] hover:text-white"
          >
            <X className="h-4 w-4" strokeWidth={2.25} />
          </button>
        </div>

        <ul className="flex flex-col gap-3 p-6">
          {CREDIT_POLICY.items.map((item) => (
            <CheckBullet key={item}>{item}</CheckBullet>
          ))}
        </ul>

        <div className="flex justify-end border-t border-[#2a2a2a] p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full bg-[#fafafa] px-5 py-2 text-sm font-medium text-[#111111] transition-colors hover:bg-[#e0e0e0]"
          >
            {CREDIT_POLICY.dismissLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
