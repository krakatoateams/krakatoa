"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { LandingNav } from "./LandingNav";
import { TextRollButton } from "./TextRollButton";
import { HeroCollageHeadline } from "./HeroCollageHeadline";
import { HeroFloatingSocialIcons } from "./HeroFloatingSocialIcons";
import { ToolsSection } from "./ToolsSection";

const HeroShaderBackground = dynamic(
  () => import("./HeroShaderBackground").then((m) => m.HeroShaderBackground),
  { ssr: false }
);

const GrowthToggleLogin = dynamic(
  () => import("@/components/GrowthToggleLogin").then((m) => m.GrowthToggleLogin),
  { ssr: false }
);

const ABOUT_SMALL =
  "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260516_090123_74be96d4-9c1b-40cf-932a-96f4f4babed3.png&w=1280&q=85";
const ABOUT_LARGE =
  "https://images.higgs.ai/?default=1&output=webp&url=https%3A%2F%2Fd8j0ntlcm91z4.cloudfront.net%2Fuser_38xzZboKViGWJOttwIXH07lWA1P%2Fhf_20260516_090133_c157d30b-a99a-4477-bec1-a446149ec3f2.png&w=1280&q=85";

function SectionBadge({
  number,
  label,
  borderClass = "border-gray-200",
}: {
  number: string;
  label: string;
  borderClass?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex w-6 h-6 sm:w-7 sm:h-7 items-center justify-center rounded-full bg-gray-900 text-white text-[11px] sm:text-xs font-semibold">
        {number}
      </span>
      <span
        className={`text-xs sm:text-[13px] font-medium border ${borderClass} rounded-full px-3 sm:px-4 py-1 sm:py-1.5 text-gray-900`}
      >
        {label}
      </span>
    </div>
  );
}

export function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-white text-gray-900 overflow-x-hidden font-sans">
      {/* Section 1 — Hero */}
      <section className="relative min-h-screen flex flex-col bg-[#EFEFEF] overflow-hidden">
        <HeroShaderBackground />
        <LandingNav />

        <div className="relative z-20 flex flex-1 flex-col items-center justify-center max-w-[1440px] w-full mx-auto px-5 sm:px-8 lg:px-12 py-14 sm:py-16 lg:py-20">
          <HeroFloatingSocialIcons>
          <div className="flex flex-col items-center gap-0 px-1 -my-[10px] text-center w-full">
            <HeroCollageHeadline />

            <div className="mt-8 sm:mt-12 flex justify-center">
              <TextRollButton
                href="#growth"
                className="inline-flex items-center gap-2 bg-[#F26522] hover:bg-[#e05a1a] text-white text-[13px] sm:text-sm font-medium rounded-full pl-5 sm:pl-6 pr-2 py-2 transition-colors"
                iconWrapperClassName="w-7 h-7 sm:w-8 sm:h-8"
                iconVariant="orange"
              >
                Start a project
              </TextRollButton>
            </div>

            <div id="growth" className="mt-10 sm:mt-14 flex justify-center">
              <GrowthToggleLogin />
            </div>
          </div>
          </HeroFloatingSocialIcons>
        </div>
      </section>

      {/* Section 2 — About */}
      <section id="about" className="bg-white pt-16 sm:pt-20 lg:pt-32 pb-12 sm:pb-16 lg:pb-24 overflow-hidden">
        <div className="max-w-[1440px] mx-auto">
          <div className="px-5 sm:px-8 lg:px-12 mb-6 sm:mb-8">
            <SectionBadge number="1" label="Introducing Krakatoa" />
          </div>

          <h2
            className="px-5 sm:px-8 lg:px-12 font-medium leading-[1.12] tracking-[-0.02em] text-gray-900 mb-12 sm:mb-16 lg:mb-28 max-w-4xl"
            style={{ fontSize: "clamp(1.5rem, 4vw, 3.2rem)" }}
          >
            Strategy-led AI tools, delivering
            <br className="hidden sm:block" />
            <span className="sm:hidden"> </span>
            results in content and beyond.
          </h2>

          {/* Mobile / tablet */}
          <div className="lg:hidden px-5 sm:px-8">
            <p className="text-[15px] sm:text-[17px] leading-[1.6] font-medium text-gray-900 max-w-xl">
              Through research, creative thinking and iteration we help growing brands realize
              their digital full potential with Krakatoa&apos;s AI suite.
            </p>
            <TextRollButton
              href="#tools"
              className="mt-6 inline-flex items-center gap-2 bg-[#F26522] hover:bg-[#e05a1a] text-white text-sm font-medium rounded-full pl-5 pr-2 py-2 transition-colors"
              iconVariant="orange"
            >
              Explore our tools
            </TextRollButton>
            <div className="mt-10 flex flex-col sm:flex-row gap-4 sm:gap-5">
              <div className="relative sm:w-[45%] aspect-[438/346] rounded-xl sm:rounded-2xl overflow-hidden">
                <Image src={ABOUT_SMALL} alt="" fill className="object-cover" sizes="45vw" />
              </div>
              <div className="relative sm:w-[55%] aspect-[900/600] rounded-xl sm:rounded-2xl overflow-hidden">
                <Image src={ABOUT_LARGE} alt="" fill className="object-cover" sizes="55vw" />
              </div>
            </div>
          </div>

          {/* Desktop */}
          <div className="hidden lg:grid grid-cols-[26%_1fr_48%] items-end gap-6 xl:gap-8 px-5 sm:px-8 lg:px-12">
            <div className="relative self-end aspect-[438/346] rounded-2xl overflow-hidden">
              <Image src={ABOUT_SMALL} alt="" fill className="object-cover" sizes="26vw" />
            </div>
            <div className="self-start flex flex-col items-end">
              <p className="text-base xl:text-lg leading-[1.65] font-medium text-gray-900 text-right whitespace-nowrap">
                Through research, creative thinking
                <br />
                and iteration we help growing brands
                <br />
                realize their digital full potential.
              </p>
              <TextRollButton
                href="#tools"
                className="mt-8 inline-flex items-center gap-2 bg-[#F26522] hover:bg-[#e05a1a] text-white text-sm font-medium rounded-full pl-5 pr-2 py-2 transition-colors"
                iconVariant="orange"
              >
                Explore our tools
              </TextRollButton>
            </div>
            <div className="relative self-end aspect-[3/2] rounded-2xl overflow-hidden">
              <Image src={ABOUT_LARGE} alt="" fill className="object-cover" sizes="48vw" />
            </div>
          </div>
        </div>
      </section>

      <ToolsSection />

      <footer className="bg-gray-900 text-white px-5 sm:px-8 lg:px-12 py-12">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div>
            <span className="font-medium text-lg">Krakatoa</span>
            <p className="mt-2 text-sm text-gray-400 max-w-xs">
              The next generation AI platform for creators and modern brands.
            </p>
          </div>
          <p className="text-sm text-gray-500">&copy; 2025 Krakatoa. Built for the future of content.</p>
        </div>
      </footer>
    </div>
  );
}
