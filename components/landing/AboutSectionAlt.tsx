"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Gift, type LucideIcon } from "lucide-react";
import { TextRollButton } from "./TextRollButton";

const ABOUT_PHOTOS = [
  "https://images.unsplash.com/photo-1614858978391-a3feca014006?w=1200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1767571900953-a6efae9c0ac1?w=1200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1761898565688-b5dec21c908a?w=1200&auto=format&fit=crop&q=80",
  "https://images.unsplash.com/photo-1675573206424-36f844f7627a?w=1200&auto=format&fit=crop&q=80",
];

function FadePhotoCarousel({
  images,
  intervalMs = 4000,
}: {
  images: string[];
  intervalMs?: number;
}) {
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (images.length <= 1) return;
    const id = setInterval(
      () => setActive((prev) => (prev + 1) % images.length),
      intervalMs
    );
    return () => clearInterval(id);
  }, [images.length, intervalMs]);

  return (
    <>
      {images.map((src, i) => (
        <Image
          key={src}
          src={src}
          alt="AI-generated content creation"
          fill
          priority={i === 0}
          className={`object-cover object-[center_30%] transition-opacity duration-1000 ease-in-out ${
            i === active ? "opacity-100" : "opacity-0"
          }`}
          sizes="(min-width: 1024px) 50vw, 100vw"
        />
      ))}
    </>
  );
}

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
              AI video and images,
              <br className="hidden sm:block" />
              <span className="sm:hidden"> </span>
              from prompt to
              <br className="hidden sm:block" />
              <span className="sm:hidden"> </span>
              post in minutes.
            </h2>
            <p className="mt-6 max-w-md text-base leading-relaxed text-white/70 sm:mt-7">
              Generate faceless reels, cinematic clips, and studio-grade product
              photos with one AI suite — scripted, generated, captioned, and
              ready to publish.
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
              We don&apos;t just generate content — we help brands realize
              their voice at scale.
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
              <span>Kelolako team · est. 2026</span>
            </div>
          </div>

          <StatCard
            icon={Gift}
            value="Free to start"
            label="Register now — no commitment, no card required"
            tone="dark"
            className="sm:col-span-2 lg:col-span-1"
          />
        </div>
      </div>
    </section>
  );
}
