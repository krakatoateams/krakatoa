"use client";

import type { ReactNode } from "react";
import { Circle, Square, Triangle, type LucideIcon } from "lucide-react";
import { LandingNav } from "./LandingNav";
import { TextRollButton } from "./TextRollButton";
import { HeroCollageHeadline } from "./HeroCollageHeadline";
import { HeroFloatingSocialIcons } from "./HeroFloatingSocialIcons";

const AI_MODELS: { name: string; Icon: LucideIcon }[] = [
  { name: "Nano Banana 2", Icon: Circle },
  { name: "Kling 3", Icon: Triangle },
  { name: "Seedance 2", Icon: Square },
];

/**
 * Greyscale strip of the AI models powering Krakatoa, pinned to the bottom
 * center of the hero. Rendered as monochrome wordmarks (no brand assets), so
 * they read as muted "logos" over the video backdrop.
 */
function HeroModelStrip() {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-6 z-20 flex justify-center px-5 sm:bottom-8">
      <div className="flex flex-col items-center gap-3">
        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/50 sm:text-[11px]">
          Powered by leading AI models
        </span>
        <div className="flex flex-wrap items-center justify-center gap-x-7 gap-y-3 grayscale sm:gap-x-10">
          {AI_MODELS.map(({ name, Icon }) => (
            <span
              key={name}
              className="flex items-center gap-1.5 text-sm font-semibold tracking-tight text-white/70 sm:text-base"
            >
              <Icon
                className="h-3.5 w-3.5 fill-current text-white/35"
                strokeWidth={2}
              />
              {name}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Shared hero shell. `background` slots into the very back of the section
 * (z-0), the nav and content stack on top (z-20+) regardless of which
 * variant supplies the background.
 */
export function HeroLayout({
  background,
  tone = "dark",
}: {
  background: ReactNode;
  tone?: "dark" | "light";
}) {
  return (
    <section className="relative min-h-screen flex flex-col bg-[#EFEFEF] overflow-hidden">
      {background}
      <LandingNav />

      <div className="relative z-20 flex flex-1 flex-col items-center justify-center max-w-[1440px] w-full mx-auto px-5 sm:px-8 lg:px-12 py-14 sm:py-16 lg:py-20">
        <HeroFloatingSocialIcons>
          <div className="flex flex-col items-center gap-0 px-1 -my-[10px] text-center w-full">
            <HeroCollageHeadline tone={tone} />

            <div className="mt-8 sm:mt-12 flex justify-center">
              <TextRollButton
                href="#features"
                className="inline-flex items-center gap-2 bg-[#F26522] hover:bg-[#e05a1a] text-white text-base sm:text-lg font-medium rounded-full pl-7 sm:pl-8 pr-3 py-3 transition-colors"
                textClassName="h-6 sm:h-7"
                iconWrapperClassName="w-10 h-10 sm:w-11 sm:h-11"
                iconClassName="w-4 h-4 sm:w-[18px] sm:h-[18px]"
                iconVariant="orange"
              >
                Start a project
              </TextRollButton>
            </div>
          </div>
        </HeroFloatingSocialIcons>
      </div>

      <HeroModelStrip />
    </section>
  );
}
