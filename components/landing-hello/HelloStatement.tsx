"use client";

import { HERO_SUBCOPY } from "@/lib/landing-content";
import { RevealText } from "./RevealText";

/**
 * Standalone supporting statement between the hero and the About section. The
 * copy reveals word-by-word on scroll; timings are dialled up here (larger
 * stagger + longer per-word duration) for a slower, more deliberate reveal.
 */
export function HelloStatement() {
  return (
    <section className="relative flex flex-col items-center justify-center overflow-hidden bg-[#0a0a0a] px-5 py-28 text-center sm:px-8 sm:py-36 lg:px-12">
      <RevealText
        text={HERO_SUBCOPY}
        className="max-w-[1000px] text-center font-medium text-[#ededed]"
        stagger={70}
        duration={1100}
        style={{
          fontSize: "clamp(1.6rem, 3.4vw, 2.6rem)",
          lineHeight: 1.32,
          letterSpacing: "-0.8px",
        }}
      />
    </section>
  );
}
