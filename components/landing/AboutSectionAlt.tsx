"use client";

import Image from "next/image";
import { Gift, type LucideIcon } from "lucide-react";
import { TextRollButton } from "./TextRollButton";
import { FadePhotoCarousel } from "./FadePhotoCarousel";
import { ABOUT, ABOUT_PHOTOS } from "@/lib/landing-content";

function StatCard({
  value,
  label,
  icon: Icon,
  tone,
  className = "",
}: {
  value: string;
  label: string;
  icon: LucideIcon;
  tone: "light" | "dark";
  className?: string;
}) {
  const isDark = tone === "dark";
  return (
    <div
      className={`relative flex min-h-[160px] flex-col justify-between rounded-3xl p-6 sm:min-h-[180px] sm:p-7 ${
        isDark
          ? "bg-gray-900 text-white"
          : "bg-white text-gray-900 ring-1 ring-black/[0.06] shadow-[0_8px_30px_-12px_rgba(0,0,0,0.06)]"
      } ${className}`}
    >
      <Icon
        className={`h-5 w-5 ${isDark ? "text-[#F26522]" : "text-gray-400"}`}
        strokeWidth={2}
      />
      <div>
        <p
          className="font-medium leading-none tracking-[-0.03em]"
          style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)" }}
        >
          {value}
        </p>
        <p
          className={`mt-2 text-sm leading-snug ${
            isDark ? "text-white/70" : "text-gray-600"
          }`}
        >
          {label}
        </p>
      </div>
    </div>
  );
}

export function AboutSectionAlt() {
  return (
    <section
      id="about"
      className="relative bg-white pt-16 pb-12 sm:pt-20 sm:pb-16 lg:pt-32 lg:pb-24 overflow-hidden"
    >
      <div className="relative z-10 mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 lg:gap-6">
          {/* Hero — headline + paragraph + CTA */}
          <div className="flex min-h-[360px] flex-col rounded-3xl bg-gray-900 p-7 text-white sm:col-span-2 sm:p-8 lg:col-span-2 lg:p-10">
            <h2
              className="font-medium leading-[1.06] tracking-[-0.02em]"
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
            <p className="mt-6 max-w-md text-base leading-relaxed text-white/70 sm:mt-7">
              {ABOUT.body}
            </p>
            <div className="mt-auto pt-8 lg:pt-10">
              <TextRollButton
                href={ABOUT.cta.href}
                className="inline-flex items-center gap-2 bg-[#F26522] hover:bg-[#e05a1a] text-white text-sm font-medium rounded-full pl-5 pr-2 py-2 transition-colors"
                iconVariant="orange"
              >
                {ABOUT.cta.label}
              </TextRollButton>
            </div>
          </div>

          {/* Editorial photo — matches the height of the hero card on desktop */}
          <div className="relative min-h-[360px] overflow-hidden rounded-3xl bg-gray-900 sm:col-span-2 lg:col-span-2 lg:min-h-0">
            <FadePhotoCarousel images={ABOUT_PHOTOS} />
          </div>

          {/* Manifesto quote */}
          <div className="relative overflow-hidden rounded-3xl bg-[#F26522] p-7 text-white sm:col-span-2 sm:p-8 lg:col-span-3 lg:p-10">
            <p
              className="max-w-2xl font-medium leading-[1.25]"
              style={{ fontSize: "clamp(1.25rem, 2.2vw, 1.625rem)" }}
            >
              {ABOUT.manifesto}
            </p>
            <div className="mt-6 flex items-center gap-3 text-sm text-white/85">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-black ring-1 ring-white/30">
                <Image
                  src="/Logo Black.png"
                  alt="Kelolako"
                  width={48}
                  height={48}
                  className="h-full w-full object-contain p-1.5"
                />
              </span>
              <span>{ABOUT.byline}</span>
            </div>
          </div>

          <StatCard
            icon={Gift}
            value={ABOUT.stat.value}
            label={ABOUT.stat.label}
            tone="dark"
            className="sm:col-span-2 lg:col-span-1"
          />
        </div>
      </div>
    </section>
  );
}
