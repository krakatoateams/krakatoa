"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Check, Flame } from "lucide-react";
import { TextRollButton } from "./TextRollButton";

// useLayoutEffect on the server logs a warning; this component is "use client"
// but Next still SSR's the initial render, so fall back to useEffect on the
// server and useLayoutEffect on the client to avoid the warning + flicker.
const useIsoLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

type Mode = "plans" | "credits";

type Plan = {
  id: "free" | "pro" | "studio";
  name: string;
  price: string;
  cadence: string;
  tagline: string;
  features: string[];
  ctaHref: string;
  ctaLabel: string;
  featured?: boolean;
};

type CreditPack = {
  id: string;
  credits: string;
  price: string;
  bonus?: { base: string; bonus: string };
  flashSale?: boolean;
  ctaHref: string;
};

const PLANS: Plan[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    cadence: "/mo",
    tagline: "Try the suite. Ship your first reel.",
    features: [
      "5 AI reels per month",
      "Standard templates",
      "Standard generation queue",
      "Krakatoa watermark",
    ],
    ctaHref: "#growth",
    ctaLabel: "Start free",
  },
  {
    id: "pro",
    name: "Pro",
    price: "$29",
    cadence: "/mo",
    featured: true,
    tagline: "Everything solo creators need to grow.",
    features: [
      "50 AI reels per month",
      "All tools incl. Product Photo + Scheduler",
      "No watermark",
      "Priority generation",
      "Caption studio + ASS subtitles",
    ],
    ctaHref: "#growth",
    ctaLabel: "Get Pro",
  },
  {
    id: "studio",
    name: "Studio",
    price: "$99",
    cadence: "/mo",
    tagline: "For teams and growing brands.",
    features: [
      "Unlimited AI reels",
      "Team seats + roles",
      "API access",
      "Advanced analytics",
      "Priority support",
    ],
    ctaHref: "#growth",
    ctaLabel: "Talk to us",
  },
];

const CREDIT_PACKS: CreditPack[] = [
  {
    id: "p1",
    credits: "100",
    price: "$1.49",
    bonus: { base: "98.34", bonus: "1.66" },
    flashSale: true,
    ctaHref: "#growth",
  },
  { id: "p3", credits: "660", price: "$10", ctaHref: "#growth" },
  { id: "p4", credits: "1,320", price: "$20", ctaHref: "#growth" },
  {
    id: "p5",
    credits: "3,500",
    price: "$50",
    bonus: { base: "3,300", bonus: "200" },
    flashSale: true,
    ctaHref: "#growth",
  },
];

function CardShell({
  featured,
  children,
}: {
  featured: boolean;
  children: React.ReactNode;
}) {
  const cardClasses = featured
    ? "relative flex h-full flex-col rounded-3xl bg-gray-900 p-7 text-white shadow-[0_24px_60px_-20px_rgba(0,0,0,0.4)] sm:p-8 lg:-translate-y-2"
    : "relative flex h-full flex-col rounded-3xl bg-white p-7 text-gray-900 ring-1 ring-black/[0.06] shadow-[0_12px_40px_-16px_rgba(0,0,0,0.10)] sm:p-8";

  return <div className={cardClasses}>{children}</div>;
}

function FeatureList({
  features,
  featured,
}: {
  features: string[];
  featured: boolean;
}) {
  return (
    <ul className="mb-8 flex flex-col gap-3">
      {features.map((feature) => (
        <li
          key={feature}
          className={`flex items-start gap-3 text-sm leading-relaxed ${
            featured ? "text-white/90" : "text-gray-700"
          }`}
        >
          <span
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
              featured ? "bg-white/10" : "bg-gray-900/[0.04]"
            }`}
          >
            <Check
              className={`h-3 w-3 ${featured ? "text-white" : "text-gray-900"}`}
              strokeWidth={2.5}
            />
          </span>
          <span>{feature}</span>
        </li>
      ))}
    </ul>
  );
}

function CardCta({
  featured,
  href,
  label,
}: {
  featured: boolean;
  href: string;
  label: string;
}) {
  const ctaClass = featured
    ? "mt-auto inline-flex items-center gap-2 self-stretch justify-between rounded-full bg-[#F26522] pl-5 pr-2 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#e05a1a]"
    : "mt-auto inline-flex items-center gap-2 self-stretch justify-between rounded-full bg-gray-900 pl-5 pr-2 py-2.5 text-sm font-medium text-white transition-colors hover:bg-gray-800";

  return (
    <TextRollButton
      href={href}
      className={ctaClass}
      iconWrapperClassName="w-7 h-7"
      iconVariant={featured ? "orange" : "dark"}
    >
      {label}
    </TextRollButton>
  );
}

function PricingCard({ plan }: { plan: Plan }) {
  const featured = plan.featured ?? false;
  const taglineColor = featured ? "text-white/70" : "text-gray-600";
  const dividerColor = featured ? "border-white/10" : "border-gray-200";
  const tierLabelColor = featured ? "text-white/60" : "text-gray-500";
  const cadenceColor = featured ? "text-white/60" : "text-gray-500";

  return (
    <CardShell featured={featured}>
      {featured && (
        <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[#F26522] px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-white shadow-[0_8px_20px_-8px_rgba(242,101,34,0.6)]">
          Most popular
        </span>
      )}

      <p
        className={`text-[11px] font-semibold uppercase tracking-[0.18em] ${tierLabelColor}`}
      >
        {plan.name}
      </p>

      <div className="mt-4 flex items-baseline gap-1">
        <span
          className="font-medium leading-none tracking-[-0.03em]"
          style={{ fontSize: "clamp(2.25rem, 4.5vw, 3.25rem)" }}
        >
          {plan.price}
        </span>
        <span className={`text-sm font-medium ${cadenceColor}`}>
          {plan.cadence}
        </span>
      </div>

      <p className={`mt-3 text-sm leading-relaxed ${taglineColor}`}>
        {plan.tagline}
      </p>

      <div className={`my-6 border-t ${dividerColor}`} />

      <FeatureList features={plan.features} featured={featured} />

      <CardCta featured={featured} href={plan.ctaHref} label={plan.ctaLabel} />
    </CardShell>
  );
}

function CreditRow({ pack }: { pack: CreditPack }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl bg-white p-5 ring-1 ring-black/[0.06] shadow-[0_8px_30px_-12px_rgba(0,0,0,0.06)] transition-shadow hover:shadow-[0_14px_40px_-14px_rgba(0,0,0,0.12)] sm:p-6">
      <Flame
        aria-hidden
        strokeWidth={1.25}
        className="pointer-events-none absolute -right-3 -bottom-3 h-24 w-24 text-emerald-500/[0.06]"
      />

      <div className="relative z-10 flex items-center gap-4 sm:gap-6">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Flame className="h-5 w-5 text-emerald-500" strokeWidth={2.25} />
            <span
              className="font-semibold leading-none tracking-[-0.02em] text-gray-900"
              style={{ fontSize: "clamp(1.5rem, 2.2vw, 1.875rem)" }}
            >
              {pack.credits}
            </span>
            {pack.flashSale && (
              <span className="ml-1 rounded-md bg-gray-900/[0.06] px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                Flash Sale
              </span>
            )}
          </div>
          {pack.bonus && (
            <p className="mt-1.5 text-[12px] text-gray-500">
              Total: {pack.bonus.base} +{" "}
              <span className="font-medium text-emerald-600">
                {pack.bonus.bonus} Bonus
              </span>
            </p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          <span className="text-base font-medium text-gray-900 sm:text-lg">
            {pack.price}
          </span>
          <a
            href={pack.ctaHref}
            className="rounded-full bg-gray-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-800 sm:text-sm"
          >
            Purchase
          </a>
        </div>
      </div>
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
  const plansRef = useRef<HTMLButtonElement | null>(null);
  const creditsRef = useRef<HTMLButtonElement | null>(null);
  const [highlight, setHighlight] = useState<{ x: number; w: number } | null>(
    null
  );

  useIsoLayoutEffect(() => {
    const el = mode === "plans" ? plansRef.current : creditsRef.current;
    if (!el) return;
    setHighlight({ x: el.offsetLeft, w: el.offsetWidth });
  }, [mode]);

  useEffect(() => {
    const onResize = () => {
      const el = mode === "plans" ? plansRef.current : creditsRef.current;
      if (!el) return;
      setHighlight({ x: el.offsetLeft, w: el.offsetWidth });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [mode]);

  return (
    <div
      role="tablist"
      aria-label="Pricing model"
      className="relative inline-flex items-center rounded-full bg-gray-900/95 p-1.5 ring-1 ring-white/10 shadow-[0_10px_30px_-12px_rgba(0,0,0,0.4)]"
    >
      {highlight && (
        <span
          aria-hidden
          className="absolute inset-y-1.5 rounded-full bg-white/[0.08] ring-1 ring-white/10 transition-[transform,width] duration-300 ease-out"
          style={{
            transform: `translateX(${highlight.x}px)`,
            width: `${highlight.w}px`,
          }}
        />
      )}

      <button
        ref={plansRef}
        type="button"
        role="tab"
        aria-selected={mode === "plans"}
        aria-controls="pricing-grid"
        onClick={() => onChange("plans")}
        className={`relative z-10 rounded-full px-6 py-2 text-sm font-medium transition-colors ${
          mode === "plans"
            ? "text-white"
            : "text-white/55 hover:text-white/80"
        }`}
      >
        Plans
      </button>

      <button
        ref={creditsRef}
        type="button"
        role="tab"
        aria-selected={mode === "credits"}
        aria-controls="pricing-grid"
        onClick={() => onChange("credits")}
        className={`relative z-10 inline-flex items-center gap-2 rounded-full px-6 py-2 text-sm font-medium transition-colors ${
          mode === "credits"
            ? "text-white"
            : "text-white/55 hover:text-white/80"
        }`}
      >
        Credits
        <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-semibold italic text-emerald-300 ring-1 ring-emerald-500/30">
          New
        </span>
      </button>
    </div>
  );
}

export function PricingSectionAlt() {
  const [mode, setMode] = useState<Mode>("plans");

  return (
    <section
      id="pricing-alt"
      className="bg-white pt-16 pb-16 sm:pt-20 sm:pb-20 lg:pt-28 lg:pb-28"
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(15, 23, 42, 0.14) 1.5px, transparent 1.6px)",
        backgroundSize: "22px 22px",
      }}
    >
      <div className="mx-auto max-w-[1440px]">
        <div className="px-5 sm:px-8 lg:px-12">
          <h2
            className="max-w-3xl font-medium leading-[1.08] tracking-[-0.02em] text-gray-900"
            style={{ fontSize: "clamp(1.75rem, 5vw, 3rem)" }}
          >
            Pricing that scales with your content.
          </h2>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-gray-600 sm:text-base">
            Start free, upgrade when you&apos;re ready. Cancel anytime.
          </p>
        </div>

        <div className="mt-8 flex justify-center px-5 sm:mt-10 sm:px-8 lg:px-12">
          <ModeToggle mode={mode} onChange={setMode} />
        </div>

        <div
          id="pricing-grid"
          className="mt-10 px-5 sm:mt-14 sm:px-8 lg:mt-16 lg:px-12"
        >
          {mode === "plans" ? (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-7 xl:gap-8">
              {PLANS.map((plan) => (
                <PricingCard key={plan.id} plan={plan} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-5 lg:items-start lg:gap-12">
              <aside className="lg:col-span-2 lg:sticky lg:top-28">
                <h3
                  className="font-medium leading-[1.12] tracking-[-0.02em] text-gray-900"
                  style={{ fontSize: "clamp(1.5rem, 3vw, 2rem)" }}
                >
                  Pay only for what you create.
                </h3>
                <p className="mt-3 text-[15px] leading-relaxed text-gray-600">
                  Buy credits in bulk and spend them across every Krakatoa
                  tool. No subscription. No surprise charges.
                </p>

                <ul className="mt-6 flex flex-col gap-3">
                  {[
                    "Mix & match across reels, photos, and captions",
                    "Bonus credits on $50+ packs",
                    "No monthly commitment",
                    "2-year validity from redemption",
                  ].map((f) => (
                    <li
                      key={f}
                      className="flex items-start gap-3 text-[14px] leading-relaxed text-gray-700"
                    >
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/10">
                        <Check
                          className="h-3 w-3 text-emerald-600"
                          strokeWidth={2.5}
                        />
                      </span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <p className="mt-6 text-[12px] text-gray-500">
                  ~10 credits per AI reel · 2 per product photo · 1 per caption
                </p>
                <p className="mt-3 text-[12px] leading-relaxed text-gray-400">
                  Credits cannot be exchanged for memberships, nor refunded,
                  transferred, or withdrawn.{" "}
                  <a
                    href="#credits-policy"
                    className="font-medium text-emerald-600 hover:text-emerald-700"
                  >
                    Credits Policy
                  </a>
                </p>
              </aside>

              <div className="flex flex-col gap-3 lg:col-span-3 lg:gap-4">
                {CREDIT_PACKS.map((pack) => (
                  <CreditRow key={pack.id} pack={pack} />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
