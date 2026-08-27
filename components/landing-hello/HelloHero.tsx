"use client";

import { useState } from "react";
import { ArrowDown } from "lucide-react";
import { TextRollButton } from "@/components/landing/TextRollButton";
import { HeroSeeHowCta } from "@/components/landing/HeroSeeHowCta";
import { VideoBackdrop } from "@/components/landing/HeroSectionVideo";
import { LANDING_SHOWREEL } from "@/lib/landing-media";
import {
  AI_MODELS_LABEL,
  HERO_HEADLINE_LINES,
} from "@/lib/landing-content";
import { HelloNav } from "./HelloNav";
import { ctaAccent, ctaGhost } from "./theme";

/**
 * The clips now sit inside a contained panel rather than behind the whole
 * hero, so they only need a light knock-back instead of being pushed all the
 * way down to the stage colour.
 */
const VIDEO_OVERLAY = "bg-N0/15";

const SHOWREEL_SRCS = LANDING_SHOWREEL.map((entry) => entry.src);

/**
 * Variant-specific, so deliberately not the shared PRIMARY_CTA: /dashboard for
 * everyone (guests get bounced to login from there) instead of splitting on
 * auth state.
 */
const HERO_PRIMARY_CTA = { label: "Try now", href: "/dashboard" };

/** Doubles as the playlist selector: each model plays its own clip. */
function ModelStrip({
  activeIndex,
  onSelect,
}: {
  activeIndex: number;
  onSelect: (index: number) => void;
}) {
  return (
    <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-N0/85 via-N0/45 to-transparent px-5 pb-6 pt-20 sm:pb-8">
      <span className="block text-[10px] font-medium uppercase tracking-[0.22em] text-N900/55 sm:text-[11px]">
        {AI_MODELS_LABEL}
      </span>
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-8 gap-y-2 sm:gap-x-14">
        {LANDING_SHOWREEL.map(({ model }, i) => {
          const active = i === activeIndex;
          return (
            <button
              key={model}
              type="button"
              onClick={() => onSelect(i)}
              aria-current={active ? "true" : undefined}
              aria-label={`Play the ${model} clip`}
              className={`text-sm font-medium tracking-tight transition-colors sm:text-lg ${
                active ? "text-N900" : "text-N900/45 hover:text-N900/80"
              }`}
            >
              {model}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function HelloHero() {
  const [activeClip, setActiveClip] = useState(0);

  return (
    <section className="relative flex min-h-screen flex-col overflow-hidden bg-N0">
      <HelloNav />

      <div className="relative z-20 mx-auto flex w-full max-w-[1440px] flex-1 flex-col items-center justify-center px-5 pt-32 pb-16 text-center sm:px-8 sm:pt-36 lg:px-12 lg:pb-20">
        <h1
          className="max-w-4xl font-display font-medium leading-[1.04] tracking-[-0.035em] text-N900"
          style={{ fontSize: "clamp(2.25rem, 6vw, 4.5rem)" }}
        >
          {HERO_HEADLINE_LINES.map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3 sm:mt-10">
          <TextRollButton
            href={HERO_PRIMARY_CTA.href}
            className={ctaAccent}
            iconVariant="invert"
            iconWrapperClassName="w-7 h-7"
          >
            {HERO_PRIMARY_CTA.label}
          </TextRollButton>

          <HeroSeeHowCta
            className={ctaGhost}
            icon={ArrowDown}
            iconHoverClassName="group-hover:translate-y-1"
            iconVariant="invert"
            iconWrapperClassName="w-6 h-6"
            iconClassName="w-3.5 h-3.5"
          />
        </div>

        {/* Showreel panel: the clips, plus the models that power them. */}
        <div className="relative mt-12 aspect-[16/10] w-full overflow-hidden rounded-2xl bg-N50 sm:mt-16 sm:aspect-video lg:aspect-[21/9]">
          <VideoBackdrop
            srcs={SHOWREEL_SRCS}
            overlayClassName={VIDEO_OVERLAY}
            activeIndex={activeClip}
            onActiveIndexChange={setActiveClip}
          />
          <ModelStrip activeIndex={activeClip} onSelect={setActiveClip} />
        </div>
      </div>
    </section>
  );
}
