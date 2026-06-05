"use client";

import Image from "next/image";
import { Sparkles, Users, Zap, type LucideIcon } from "lucide-react";
import { TextRollButton } from "./TextRollButton";

const ABOUT_PHOTO =
  "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260516_090133_c157d30b-a99a-4477-bec1-a446149ec3f2.png&w=1280&q=85";

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
      {/* Decorative outlined "01" watermark — sits behind the bento */}
      <span
        aria-hidden
        className="pointer-events-none absolute right-[-3%] top-[4%] z-0 select-none font-bold leading-[0.85] tracking-[-0.06em]"
        style={{
          fontSize: "clamp(8rem, 22vw, 20rem)",
          color: "transparent",
          WebkitTextStroke: "1.5px rgb(229 231 235)",
        }}
      >
        01
      </span>

      <div className="relative z-10 mx-auto max-w-[1440px] px-5 sm:px-8 lg:px-12">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4 lg:gap-6">
          {/* Hero — headline + paragraph + CTA */}
          <div className="flex min-h-[360px] flex-col rounded-3xl bg-gray-900 p-7 text-white sm:col-span-2 sm:p-8 lg:col-span-2 lg:row-span-2 lg:p-10">
            <h2
              className="font-medium leading-[1.06] tracking-[-0.02em]"
              style={{ fontSize: "clamp(1.75rem, 4.2vw, 3rem)" }}
            >
              Strategy-led AI tools,
              <br className="hidden sm:block" />
              <span className="sm:hidden"> </span>
              delivering results
              <br className="hidden sm:block" />
              <span className="sm:hidden"> </span>
              in content and beyond.
            </h2>
            <p className="mt-6 max-w-md text-base leading-relaxed text-white/70 sm:mt-7">
              Research, creative thinking, and iteration help growing brands
              realize their full digital potential with Krakatoa&apos;s AI
              suite.
            </p>
            <div className="mt-auto pt-8 lg:pt-10">
              <TextRollButton
                href="#features"
                className="inline-flex items-center gap-2 bg-[#F26522] hover:bg-[#e05a1a] text-white text-sm font-medium rounded-full pl-5 pr-2 py-2 transition-colors"
                iconVariant="orange"
              >
                Explore our tools
              </TextRollButton>
            </div>
          </div>

          <StatCard
            icon={Sparkles}
            value="5M+"
            label="AI reels generated"
            tone="light"
          />

          <StatCard
            icon={Users}
            value="50k+"
            label="Active creators"
            tone="light"
          />

          {/* Editorial photo */}
          <div className="relative aspect-[3/2] overflow-hidden rounded-3xl sm:col-span-2 lg:col-span-2">
            <Image
              src={ABOUT_PHOTO}
              alt=""
              fill
              className="object-cover"
              sizes="(min-width: 1024px) 50vw, 100vw"
            />
          </div>

          {/* Manifesto quote */}
          <div className="relative overflow-hidden rounded-3xl bg-[#F26522] p-7 text-white sm:col-span-2 sm:p-8 lg:col-span-3 lg:p-10">
            <p
              className="max-w-2xl font-medium leading-[1.25]"
              style={{ fontSize: "clamp(1.25rem, 2.2vw, 1.625rem)" }}
            >
              We don&apos;t just generate content — we help brands realize
              their voice at scale.
            </p>
            <div className="mt-6 flex items-center gap-3 text-sm text-white/85">
              <span className="h-7 w-7 rounded-full bg-white/20 ring-1 ring-white/30" />
              <span>Krakatoa team · est. 2026</span>
            </div>
          </div>

          <StatCard
            icon={Zap}
            value="10×"
            label="Faster delivery"
            tone="dark"
            className="sm:col-span-2 lg:col-span-1"
          />
        </div>
      </div>
    </section>
  );
}
