"use client";

import Image from "next/image";
import { TextRollButton } from "@/components/landing/TextRollButton";
import { FadePhotoCarousel } from "@/components/landing/FadePhotoCarousel";
import { ABOUT, ABOUT_PHOTOS } from "@/lib/landing-content";
import { ctaAccent, eyebrow, panel } from "./theme";
import { GatherGrid, GatherItem } from "./GatherReveal";

/** Lead text in the manifesto and stat panels, kept at one scale across both. */
const PANEL_LEAD_SIZE = "clamp(1.25rem, 2.2vw, 1.625rem)";

export function HelloAbout() {
  return (
    <section
      id="about"
      className="relative overflow-hidden bg-[#0a0a0a] pt-16 pb-12 sm:pt-20 sm:pb-16 lg:pt-28 lg:pb-20"
    >
      <div className="relative z-10 mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <GatherGrid className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          {/* Headline + paragraph + CTA */}
          <GatherItem
            from="translate3d(-44px, 24px, 0) scale(0.94)"
            delay={0}
            className={`flex min-h-[360px] flex-col p-7 sm:col-span-2 sm:p-8 lg:col-span-2 lg:p-10 ${panel}`}
          >
            <span className={eyebrow}>About</span>
            <h2
              className="mt-5 font-medium leading-[1.06] tracking-[-0.02em] text-white"
              style={{ fontSize: "clamp(1.75rem, 4.2vw, 3rem)" }}
            >
              {ABOUT.headingLines.map((line, i) => (
                <span key={line}>
                  {i > 0 ? (
                    <>
                      <br className="hidden sm:block" />
                      <span className="sm:hidden"> </span>
                    </>
                  ) : null}
                  {line}
                </span>
              ))}
            </h2>
            <p className="mt-6 max-w-md text-base leading-relaxed text-[#8a8a8a] sm:mt-7">
              {ABOUT.body}
            </p>
            <div className="mt-auto pt-8 lg:pt-10">
              <TextRollButton
                href={ABOUT.cta.href}
                className={ctaAccent}
                iconVariant="invert"
                iconWrapperClassName="w-7 h-7"
              >
                {ABOUT.cta.label}
              </TextRollButton>
            </div>
          </GatherItem>

          {/* Editorial photo */}
          <GatherItem
            from="translate3d(44px, 24px, 0) scale(0.94)"
            delay={90}
            className={`relative min-h-[360px] overflow-hidden sm:col-span-2 lg:col-span-2 lg:min-h-0 ${panel}`}
          >
            <FadePhotoCarousel images={ABOUT_PHOTOS} />
            {/* Desaturate so the photography doesn't reintroduce colour. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[#0a0a0a]/35 mix-blend-multiply"
            />
          </GatherItem>

          {/* Manifesto */}
          <GatherItem
            from="translate3d(-32px, 44px, 0) scale(0.94)"
            delay={180}
            className={`relative flex flex-col justify-start overflow-hidden p-7 sm:col-span-2 sm:p-8 lg:col-span-3 lg:p-10 ${panel}`}
          >
            <p
              className="max-w-2xl font-medium leading-[1.25] text-[#dddddd]"
              style={{ fontSize: PANEL_LEAD_SIZE }}
            >
              {ABOUT.manifesto}
            </p>
            <div className="mt-6 flex items-center gap-3 text-sm text-[#8a8a8a]">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-[#2a2a2a] bg-[#0a0a0a]">
                <Image
                  src="/Logo White transparent.svg"
                  alt="Kelolako"
                  width={44}
                  height={44}
                  className="h-full w-full object-contain p-2"
                />
              </span>
              <span>{ABOUT.byline}</span>
            </div>
          </GatherItem>

          {/* Stat */}
          <GatherItem
            from="translate3d(32px, 44px, 0) scale(0.94)"
            delay={270}
            className={`relative flex min-h-[160px] flex-col justify-start p-7 sm:col-span-2 sm:min-h-[180px] sm:p-8 lg:col-span-1 lg:p-10 ${panel}`}
          >
            <div>
              <p
                className="font-medium leading-[1.25] tracking-[-0.03em] text-white"
                style={{ fontSize: PANEL_LEAD_SIZE }}
              >
                {ABOUT.stat.value}
              </p>
              <p className="mt-2 text-sm leading-snug text-[#8a8a8a]">
                {ABOUT.stat.label}
              </p>
            </div>
          </GatherItem>
        </GatherGrid>
      </div>
    </section>
  );
}
