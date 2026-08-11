"use client";

import Image from "next/image";
import { Gift } from "lucide-react";
import { TextRollButton } from "@/components/landing/TextRollButton";
import { FadePhotoCarousel } from "@/components/landing/FadePhotoCarousel";
import { ABOUT, ABOUT_PHOTOS } from "@/lib/landing-content";
import { ctaAccent, eyebrow, indexNumeral, panel, textMuted } from "./theme";

export function HelloAbout() {
  return (
    <section
      id="about"
      className="relative overflow-hidden bg-[#0a0a0a] pt-16 pb-12 sm:pt-20 sm:pb-16 lg:pt-28 lg:pb-20"
    >
      <div className="relative z-10 mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
          {/* Headline + paragraph + CTA */}
          <div
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
          </div>

          {/* Editorial photo */}
          <div
            className={`relative min-h-[360px] overflow-hidden sm:col-span-2 lg:col-span-2 lg:min-h-0 ${panel}`}
          >
            <FadePhotoCarousel images={ABOUT_PHOTOS} />
            {/* Desaturate so the photography doesn't reintroduce colour. */}
            <div
              aria-hidden
              className="pointer-events-none absolute inset-0 bg-[#0a0a0a]/35 mix-blend-multiply"
            />
          </div>

          {/* Manifesto */}
          <div
            className={`relative overflow-hidden p-7 sm:col-span-2 sm:p-8 lg:col-span-3 lg:p-10 ${panel}`}
          >
            <span className={indexNumeral}>01</span>
            <p
              className="mt-4 max-w-2xl font-medium leading-[1.25] text-[#dddddd]"
              style={{ fontSize: "clamp(1.25rem, 2.2vw, 1.625rem)" }}
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
          </div>

          {/* Stat */}
          <div
            className={`relative flex min-h-[160px] flex-col justify-between p-6 sm:col-span-2 sm:min-h-[180px] sm:p-7 lg:col-span-1 ${panel}`}
          >
            <Gift className={`h-5 w-5 ${textMuted}`} strokeWidth={1.75} />
            <div>
              <p
                className="font-medium leading-none tracking-[-0.03em] text-white"
                style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)" }}
              >
                {ABOUT.stat.value}
              </p>
              <p className="mt-2 text-sm leading-snug text-[#8a8a8a]">
                {ABOUT.stat.label}
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
