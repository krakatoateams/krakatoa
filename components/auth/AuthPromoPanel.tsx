"use client";

import { VideoBackdrop } from "@/components/landing/HeroSectionVideo";
import { AUTH_MODAL_SHOWREEL } from "@/lib/landing-media";
import { VIDEO_MODELS } from "@/lib/video-models";

const SHOWREEL_SRCS = AUTH_MODAL_SHOWREEL.map((entry) => entry.src);

// The real, full video-model catalog (19 entries as of writing) — sourced
// directly from the live registry rather than a hand-picked subset, so this
// can never drift out of sync with what's actually offered. Deliberately
// decoupled from the video clips above: with only 2-3 clips that exist,
// there's no honest way to pair every named model with "the clip playing
// right now" (see the git history of this file for the earlier, narrower
// approach and why it was dropped) — so this is a continuous marquee of
// names, not clickable tabs tied to video selection.
const ALL_MODEL_LABELS = VIDEO_MODELS.map((m) => m.label);

/**
 * Continuously auto-scrolling marquee of every available model — reuses the
 * exact pattern HelloTestimonials.tsx already established (animate-marquee-left,
 * list duplicated once for a seamless loop, paused on hover), rather than a
 * fixed 2-3 item toggle row.
 */
function ModelMarquee() {
  return (
    <div className="group/marquee relative -mx-6 overflow-hidden px-6 sm:-mx-8 sm:px-8">
      <div className="flex w-max animate-marquee-left gap-2 group-hover/marquee:[animation-play-state:paused]">
        {[...ALL_MODEL_LABELS, ...ALL_MODEL_LABELS].map((label, i) => (
          <span
            key={`${label}-${i}`}
            className="shrink-0 rounded-full border border-N900/10 bg-N900/5 px-3 py-1 text-xs font-medium tracking-tight text-N900/70"
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * The shared visual for both sign-up and sign-in: full-bleed looping video +
 * the all-models marquee, both anchored at the bottom over a gradient
 * overlay for contrast. Title/subtitle are the only thing that differs
 * between modes — passed in rather than duplicating the video/marquee
 * markup per mode.
 */
/**
 * Splits `title` on the first occurrence of `accent` and wraps that piece in
 * the brand color, so the headline carries one colored hook phrase instead
 * of being a single flat color throughout — the same technique the Buzzy
 * reference used on its own brand name.
 */
function AccentedTitle({ title, accent }: { title: string; accent?: string }) {
  const i = accent ? title.indexOf(accent) : -1;
  if (i < 0) return <>{title}</>;
  return (
    <>
      {title.slice(0, i)}
      <span className="text-brand-primary">{title.slice(i, i + accent!.length)}</span>
      {title.slice(i + accent!.length)}
    </>
  );
}

function PromoVisual({
  title,
  titleAccent,
  subtitle,
}: {
  title: string;
  titleAccent?: string;
  subtitle: string;
}) {
  return (
    <div className="relative h-full min-h-[320px] w-full overflow-hidden">
      <VideoBackdrop srcs={SHOWREEL_SRCS} overlayClassName="bg-N0/30" />
      {/* Darker, taller gradient than a typical scrim: the showreel is busy
          footage, and title/subtitle need to read clearly over any frame of
          it, not just the darkest ones. */}
      <div className="absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-N0 via-N0/85 to-transparent px-6 pb-6 pt-32">
        <h2 className="font-display text-2xl font-bold leading-tight tracking-tight text-N900 sm:text-3xl">
          <AccentedTitle title={title} accent={titleAccent} />
        </h2>
        <p className="mt-1.5 text-body-3 text-N900/85">{subtitle}</p>
        <div className="mt-4">
          <ModelMarquee />
        </div>
      </div>
    </div>
  );
}

const COPY: Record<
  "signin" | "signup" | "forgot-password",
  { title: string; titleAccent?: string; subtitle: string }
> = {
  signup: {
    title: "Sign up and generate for free",
    titleAccent: "for free",
    subtitle: "New accounts get one free video generation, no typing needed, on us.",
  },
  signin: {
    title: "See what Kelolako can make",
    titleAccent: "Kelolako",
    subtitle: "From script to a finished, captioned video: real output, real models.",
  },
  "forgot-password": {
    title: "See what Kelolako can make",
    titleAccent: "Kelolako",
    subtitle: "From script to a finished, captioned video: real output, real models.",
  },
};

export function AuthPromoPanel({ mode }: { mode: "signin" | "signup" | "forgot-password" }) {
  const { title, titleAccent, subtitle } = COPY[mode];
  return <PromoVisual title={title} titleAccent={titleAccent} subtitle={subtitle} />;
}
