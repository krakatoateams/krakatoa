"use client";

import {
  TESTIMONIALS,
  TESTIMONIALS_HEADING,
  type Testimonial,
} from "@/lib/landing-content";
import { eyebrow } from "./theme";

const ROW_ONE = TESTIMONIALS;
const ROW_TWO = [...TESTIMONIALS].reverse();

function getInitials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function TestimonialCard({ t }: { t: Testimonial }) {
  return (
    <article className="flex w-[300px] shrink-0 flex-col gap-5 rounded-xl bg-[#171717] p-6 sm:w-[340px] sm:p-7 lg:w-[360px]">
      <p className="text-[15px] leading-relaxed text-[#dddddd]">
        &ldquo;{t.quote}&rdquo;
      </p>
      <div className="mt-auto flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#2a2a2a] bg-[#0a0a0a] text-[12px] font-medium text-[#cccccc]">
          {getInitials(t.name)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-white">{t.name}</p>
          <p className="truncate text-[12px] text-[#8a8a8a]">{t.handle}</p>
        </div>
        {/* Platform badges go monochrome — arqe's system has no chroma at all. */}
        <span className="shrink-0 rounded-full border border-[#2a2a2a] px-2.5 py-1 text-[11px] font-medium text-[#8a8a8a]">
          {t.platform}
        </span>
      </div>
    </article>
  );
}

function MarqueeRow({
  items,
  direction,
}: {
  items: Testimonial[];
  direction: "left" | "right";
}) {
  const animationClass =
    direction === "left" ? "animate-marquee-left" : "animate-marquee-right";

  return (
    <div className="group/marquee relative">
      <div
        className={`flex w-max gap-4 sm:gap-5 ${animationClass} group-hover/marquee:[animation-play-state:paused]`}
      >
        {[...items, ...items].map((t, i) => (
          <TestimonialCard key={`${t.handle}-${i}`} t={t} />
        ))}
      </div>
    </div>
  );
}

export function HelloTestimonials() {
  return (
    <section
      id="testimonials"
      className="relative overflow-hidden bg-[#0a0a0a] pt-16 pb-16 sm:pt-20 sm:pb-20 lg:pt-28 lg:pb-28"
    >
      <div className="mx-auto max-w-[1440px]">
        <div className="mb-10 px-5 sm:mb-12 sm:px-8 lg:mb-14 lg:px-12">
          <span className={eyebrow}>Testimonials</span>
          <h2
            className="mt-5 max-w-3xl font-medium leading-[1.08] tracking-[-0.02em] text-white"
            style={{ fontSize: "clamp(1.75rem, 5vw, 3rem)" }}
          >
            {TESTIMONIALS_HEADING}
          </h2>
        </div>
      </div>

      <div className="relative">
        <div className="flex flex-col gap-4 sm:gap-5">
          <MarqueeRow items={ROW_ONE} direction="left" />
          <MarqueeRow items={ROW_TWO} direction="right" />
        </div>

        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-16 bg-gradient-to-r from-[#0a0a0a] to-transparent sm:w-24"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-16 bg-gradient-to-l from-[#0a0a0a] to-transparent sm:w-24"
        />
      </div>
    </section>
  );
}
