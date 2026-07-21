"use client";

import {
  Camera,
  CalendarClock,
  Clapperboard,
  Film,
  Layers,
  Mic,
  Palette,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import BorderGlow from "@/components/BorderGlow";
import Grainient from "@/components/Grainient";

/** Decorative floating icon tiles scattered across the top of the banner. */
const NODES: { icon: LucideIcon; x: string; y: string; rotate: number }[] = [
  { icon: Video, x: "6%", y: "20%", rotate: -12 },
  { icon: Camera, x: "18%", y: "58%", rotate: 8 },
  { icon: Layers, x: "32%", y: "24%", rotate: -6 },
  { icon: Clapperboard, x: "64%", y: "26%", rotate: 6 },
  { icon: Palette, x: "80%", y: "56%", rotate: -10 },
  { icon: Mic, x: "90%", y: "22%", rotate: 12 },
];

/** Scrolling feature ticker items. */
const TICKER: { icon: LucideIcon; text: string }[] = [
  { icon: Mic, text: "AI narration & burned-in captions" },
  { icon: Camera, text: "Studio-quality product photos" },
  { icon: CalendarClock, text: "Schedule & auto-publish to YouTube" },
  { icon: Film, text: "Multiple engines — Seedance & Veo" },
  { icon: Users, text: "Character turnaround sheets" },
  { icon: Layers, text: "Storyboard to video in one flow" },
];

export default function DashboardHero() {
  return (
    <section className="mb-10">
      <BorderGlow
        borderRadius={16}
        glowColor="270 90 72"
        backgroundColor="#0b0713"
        glowRadius={40}
        glowIntensity={1}
        coneSpread={25}
        edgeSensitivity={30}
        animated
        colors={["#c084fc", "#f472b6", "#818cf8"]}
      >
      <div className="relative overflow-hidden rounded-[inherit] bg-gradient-to-b from-violet-600/20 via-gray-900 to-gray-950">
        {/* Animated Grainient background */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <Grainient
            color1="#FF9FFC"
            color2="#5227FF"
            color3="#B497CF"
            timeSpeed={0.25}
            warpStrength={1.0}
            warpFrequency={5.0}
            warpSpeed={2.0}
            warpAmplitude={50.0}
            blendSoftness={0.05}
            rotationAmount={500.0}
            noiseScale={2.0}
            grainAmount={0.1}
            grainScale={2.0}
            contrast={1.5}
            saturation={1.0}
            zoom={0.9}
          />
        </div>

        {/* Floating icon tiles */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 hidden h-1/2 md:block"
        >
          {NODES.map((node, i) => {
            const Icon = node.icon;
            return (
              <div
                key={i}
                className="hero-node absolute"
                style={{ left: node.x, top: node.y, animationDelay: `${i * 0.5}s` }}
              >
                <div
                  className="flex h-14 w-14 items-center justify-center rounded-lg border border-dashed border-white/20 bg-white/5 text-white/50 backdrop-blur-[2px]"
                  style={{ transform: `rotate(${node.rotate}deg)` }}
                >
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            );
          })}
        </div>

        {/* Centered content */}
        <div className="relative z-10 flex min-h-[250px] flex-col items-center justify-end gap-6 px-6 pb-10 pt-20 text-center">
          <div className="mx-auto flex max-w-2xl flex-col gap-4">
            <h2 className="text-balance text-4xl font-bold tracking-tight text-white sm:text-5xl">
              Create without limits
            </h2>
            <p className="mx-auto max-w-xl text-sm text-gray-300 sm:text-base">
              Generate faceless reels, studio product photos, and scroll-stopping
              content — powered by AI. Start creating in seconds.
            </p>
          </div>
        </div>

        {/* Infinite feature ticker */}
        <div className="relative flex h-12 items-center overflow-hidden border-t border-white/10 bg-gray-950/50 backdrop-blur-md">
          <div className="hero-marquee flex w-max shrink-0 items-center gap-10 whitespace-nowrap pr-10 text-xs text-white">
            {[...TICKER, ...TICKER].map((item, i) => {
              const Icon = item.icon;
              return (
                <span key={i} className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-violet-300" />
                  {item.text}
                </span>
              );
            })}
          </div>
        </div>

        <style>{`
          @keyframes heroFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-8px); }
          }
          .hero-node { animation: heroFloat 6s ease-in-out infinite; }
          @keyframes heroMarquee {
            from { transform: translateX(0); }
            to { transform: translateX(-50%); }
          }
          .hero-marquee {
            animation: heroMarquee 32s linear infinite;
            will-change: transform;
            transform: translateZ(0);
          }
          /* The floating nodes are the distracting motion; disable those under
             reduced-motion. The feature ticker is a slow, subtle scroll, so we
             keep it running (many phones report reduced-motion via Battery Saver
             or Remove-animations, which was silently freezing the ticker). */
          @media (prefers-reduced-motion: reduce) {
            .hero-node { animation: none; }
          }
        `}</style>
      </div>
      </BorderGlow>
    </section>
  );
}
