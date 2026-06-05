"use client";

import type { ReactNode } from "react";
import { LandingNav } from "./LandingNav";
import { TextRollButton } from "./TextRollButton";
import { HeroCollageHeadline } from "./HeroCollageHeadline";
import { HeroFloatingSocialIcons } from "./HeroFloatingSocialIcons";

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
    </section>
  );
}
