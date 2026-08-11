"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  FEATURES,
  FEATURES_HEADING,
  type FeatureItem,
} from "@/lib/landing-content";
import { usePinnedScrollIndex } from "@/lib/use-pinned-scroll";

function FeatureMenuItem({
  feature,
  index,
  active,
  onSelect,
}: {
  feature: FeatureItem;
  index: number;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? "true" : undefined}
      className={`relative flex w-full items-start gap-3 rounded-lg px-4 py-3.5 text-left transition-colors duration-200 ${
        active
          ? "bg-[#fafafa] text-[#111111]"
          : "text-[#cccccc] hover:bg-white/[0.04]"
      }`}
    >
      <span
        className={`mt-0.5 shrink-0 text-[11px] font-medium tabular-nums tracking-[0.08em] ${
          active ? "text-[#111111]/50" : "text-[#8a8a8a]"
        }`}
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-medium tracking-tight sm:text-[15px]">
          {feature.label}
          {feature.badge ? (
            <span
              className={`ml-2 rounded px-1.5 py-0.5 align-middle text-[10px] font-medium uppercase tracking-[0.1em] ${
                active
                  ? "bg-[#111111]/10 text-[#111111]/70"
                  : "bg-white/10 text-[#aaaaaa]"
              }`}
            >
              {feature.badge}
            </span>
          ) : null}
        </span>
        <span
          className={`mt-1 block text-[12px] leading-relaxed sm:text-[13px] ${
            active ? "text-[#111111]/65" : "text-[#8a8a8a]"
          }`}
        >
          {feature.description}
        </span>
      </span>
    </button>
  );
}

export function HelloFeatures() {
  const { outerRef, activeIndex, scrollToIndex } = usePinnedScrollIndex(
    FEATURES.length
  );
  const activeFeature = FEATURES[activeIndex];
  const activeId = activeFeature.id;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.load();
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  }, [activeId]);

  return (
    <section
      id="features"
      ref={outerRef}
      className="relative h-[500vh] bg-[#0a0a0a]"
    >
      <div className="sticky top-0 flex h-screen w-full overflow-hidden">
        <video
          ref={videoRef}
          src={activeFeature.video}
          key={activeFeature.id}
          autoPlay
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
          className="absolute inset-0 z-0 h-full w-full object-cover object-[center_25%]"
        />

        {/* Push the footage back toward the near-black stage. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[1] bg-[#0a0a0a]/70"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-2/3 bg-gradient-to-t from-[#0a0a0a] via-[#0a0a0a]/60 to-transparent lg:hidden"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-[1] hidden w-2/3 bg-gradient-to-r from-[#0a0a0a] via-[#0a0a0a]/70 to-transparent lg:block"
        />

        <div className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-col justify-start px-5 pt-20 sm:px-8 lg:justify-center lg:px-12 lg:pt-0">
          <h2
            className="mb-10 w-full max-w-3xl font-medium leading-[1.08] tracking-[-0.02em] text-white sm:mb-12 lg:mb-14"
            style={{ fontSize: "clamp(1.75rem, 5vw, 3rem)" }}
          >
            {FEATURES_HEADING}
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,380px)_1fr]">
            <nav
              aria-label="Feature menu"
              className="hidden flex-col gap-1 rounded-xl bg-[#171717]/90 p-2 backdrop-blur-[15px] lg:flex"
            >
              {FEATURES.map((feature, index) => (
                <FeatureMenuItem
                  key={feature.id}
                  feature={feature}
                  index={index}
                  active={activeIndex === index}
                  onSelect={() => scrollToIndex(index)}
                />
              ))}
            </nav>
          </div>
        </div>

        <div className="absolute inset-x-4 bottom-6 z-10 flex flex-col gap-3 sm:inset-x-6 sm:bottom-8 lg:hidden">
          <div className="flex items-center justify-center gap-1.5">
            {FEATURES.map((f, i) => (
              <button
                key={f.id}
                type="button"
                aria-label={`Show ${f.label}`}
                aria-current={i === activeIndex ? "true" : undefined}
                onClick={() => scrollToIndex(i)}
                className={`h-1 rounded-full transition-all duration-300 ${
                  i === activeIndex ? "w-6 bg-white" : "w-1.5 bg-white/25"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-3 rounded-xl bg-[#171717]/90 p-4 backdrop-blur-[15px]">
            <span className="shrink-0 text-[11px] font-medium tabular-nums tracking-[0.08em] text-[#8a8a8a]">
              {String(activeIndex + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-medium tracking-tight text-white">
                {activeFeature.label}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-[#8a8a8a]">
                {activeFeature.description}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => scrollToIndex(Math.max(0, activeIndex - 1))}
                disabled={activeIndex === 0}
                aria-label="Previous feature"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[#2a2a2a] text-[#cccccc] transition hover:bg-white/[0.06] disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  scrollToIndex(Math.min(FEATURES.length - 1, activeIndex + 1))
                }
                disabled={activeIndex === FEATURES.length - 1}
                aria-label="Next feature"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-[#2a2a2a] text-[#cccccc] transition hover:bg-white/[0.06] disabled:opacity-30"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
