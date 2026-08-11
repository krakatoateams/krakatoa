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
      className={`relative flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-200 sm:px-4 sm:py-3.5 ${
        active ? "bg-[#F26522] text-white" : "hover:bg-gray-50"
      }`}
    >
      {feature.badge ? (
        <span className="animate-badge-nudge pointer-events-none absolute left-full top-1/2 z-10 ml-7 -translate-y-1/2">
          <span className="relative inline-block rounded bg-white px-3.5 py-1.5 text-[13px] font-semibold text-[#F26522] shadow-[0_8px_24px_-6px_rgba(0,0,0,0.4)]">
            {feature.badge}
            <span
              aria-hidden
              className="absolute right-full top-1/2 -ml-[17px] -translate-y-1/2 border-y-[6px] border-r-[7px] border-y-transparent border-r-white"
            />
          </span>
        </span>
      ) : null}
      <span
        className={`mt-0.5 shrink-0 text-[11px] font-semibold tabular-nums ${
          active ? "text-white/70" : "text-gray-400"
        }`}
      >
        {String(index + 1).padStart(2, "0")}
      </span>
      <span className="min-w-0">
        <span className="block text-[14px] font-semibold tracking-tight sm:text-[15px]">
          {feature.label}
        </span>
        <span
          className={`mt-0.5 block text-[12px] leading-relaxed sm:text-[13px] ${
            active ? "text-white/80" : "text-gray-500"
          }`}
        >
          {feature.description}
        </span>
      </span>
    </button>
  );
}

export function FeaturesSectionAlt() {
  const { outerRef, activeIndex, scrollToIndex: scrollToFeature } =
    usePinnedScrollIndex(FEATURES.length);
  const activeFeature = FEATURES[activeIndex];
  const activeId = activeFeature.id;
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Drive the new clip whenever the active feature changes.
  // Some browsers won't pick up a new <video src> without an explicit load() call.
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.load();
    const playPromise = el.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {
        // Autoplay can fail (e.g. tab not visible); muted+playsInline usually allows it.
      });
    }
  }, [activeId]);

  return (
    <section
      id="features"
      ref={outerRef}
      className="relative h-[500vh] bg-gray-900"
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

        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-[1] bg-black/30 lg:bg-black/45"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[1] h-2/3 bg-gradient-to-t from-black/80 via-black/40 to-transparent lg:hidden"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-[1] hidden w-1/2 bg-gradient-to-r from-black/60 to-transparent lg:block"
        />

        <div className="relative z-10 mx-auto flex w-full max-w-[1440px] flex-col justify-start px-5 pt-20 sm:px-8 lg:justify-center lg:px-12 lg:pt-0">
          <h2
            className="mb-10 w-full font-medium leading-[1.08] tracking-[-0.02em] text-white sm:mb-12 lg:mb-14"
            style={{
              fontSize: "clamp(1.75rem, 5vw, 3rem)",
              textShadow: "0 2px 18px rgba(0,0,0,0.35)",
            }}
          >
            {FEATURES_HEADING}
          </h2>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,360px)_1fr]">
            <nav
              aria-label="Feature menu"
              className="hidden flex-col gap-1 rounded-2xl bg-white/95 p-2 shadow-[0_20px_50px_-20px_rgba(0,0,0,0.35)] ring-1 ring-black/[0.06] backdrop-blur-sm sm:rounded-3xl sm:p-3 lg:flex"
            >
              {FEATURES.map((feature, index) => (
                <FeatureMenuItem
                  key={feature.id}
                  feature={feature}
                  index={index}
                  active={activeId === feature.id}
                  onSelect={() => scrollToFeature(index)}
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
                onClick={() => scrollToFeature(i)}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === activeIndex ? "w-5 bg-white" : "w-1.5 bg-white/40"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-3 rounded-2xl bg-white/10 p-4 ring-1 ring-white/15 backdrop-blur-md">
            <span className="shrink-0 text-[11px] font-semibold tabular-nums text-white/60">
              {String(activeIndex + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold tracking-tight text-white">
                {activeFeature.label}
              </p>
              <p className="mt-0.5 text-[12.5px] leading-relaxed text-white/75">
                {activeFeature.description}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() =>
                  scrollToFeature(Math.max(0, activeIndex - 1))
                }
                disabled={activeIndex === 0}
                aria-label="Previous feature"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 disabled:opacity-30"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() =>
                  scrollToFeature(
                    Math.min(FEATURES.length - 1, activeIndex + 1)
                  )
                }
                disabled={activeIndex === FEATURES.length - 1}
                aria-label="Next feature"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 text-white transition hover:bg-white/25 disabled:opacity-30"
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
