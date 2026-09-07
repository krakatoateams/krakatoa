"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Camera,
  CalendarClock,
  Film,
  ImageIcon,
  Layers,
  Mic,
  Sparkles,
  Type,
  Users,
  Video,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import Grainient from "@/components/Grainient";
import { SkillsCatalogProvider, useSkillsCatalog } from "@/app/(app)/tools/skills/SkillsCatalogProvider";

/** Scrolling feature ticker items. */
const TICKER: { icon: LucideIcon; text: string }[] = [
  { icon: Mic, text: "AI narration & burned-in captions" },
  { icon: Camera, text: "Studio-quality product photos" },
  { icon: CalendarClock, text: "Schedule & auto-publish to YouTube" },
  { icon: Film, text: "Multiple engines — Seedance & Veo" },
  { icon: Users, text: "Character turnaround sheets" },
  { icon: Layers, text: "Storyboard to video in one flow" },
];

const GRAINIENT = {
  timeSpeed: 0.25,
  warpStrength: 1.0,
  warpFrequency: 5.0,
  warpSpeed: 2.0,
  warpAmplitude: 50.0,
  blendSoftness: 0.05,
  rotationAmount: 500.0,
  noiseScale: 2.0,
  grainAmount: 0.1,
  grainScale: 2.0,
  contrast: 1.5,
  saturation: 1.0,
  zoom: 0.9,
} as const;

const SKILL_REEL_ROW_PX = 36;
const SKILL_REEL_HIGHLIGHT_TOP_PX = 48;
const SKILL_REEL_SHIFT_PX = 70;
const SKILL_REEL_HOLD_MS = 1150;
const SKILL_REEL_MOVE_MS = 550;

type HeroSkill = { id: string; title: string; thumb: string };

function SkillsHeroReel() {
  const { visible, ready } = useSkillsCatalog();
  const items = useMemo<HeroSkill[]>(
    () =>
      visible
        .filter((skill) => skill.title.trim())
        .map((skill) => ({
          id: skill.id,
          title: skill.title.trim(),
          thumb: skill.thumb,
        })),
    [visible]
  );

  const rows = ready ? items : [];
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [instant, setInstant] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const itemKey = rows.map((skill) => `${skill.id}:${skill.title}`).join("|");

  useEffect(() => {
    setIndex(0);
  }, [itemKey]);

  useEffect(() => {
    if (index >= rows.length) setIndex(0);
  }, [index, rows.length]);

  useEffect(() => {
    const card = rootRef.current?.closest("a");
    if (!card) return;
    const enter = () => setPaused(true);
    const leave = () => setPaused(false);
    card.addEventListener("pointerenter", enter);
    card.addEventListener("pointerleave", leave);
    return () => {
      card.removeEventListener("pointerenter", enter);
      card.removeEventListener("pointerleave", leave);
    };
  }, []);

  useEffect(() => {
    if (paused || rows.length < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = window.setInterval(() => {
      setIndex((current) => {
        if (current + 1 >= rows.length) {
          setInstant(true);
          return 0;
        }
        setInstant(false);
        return current + 1;
      });
    }, SKILL_REEL_HOLD_MS + SKILL_REEL_MOVE_MS);
    return () => window.clearInterval(id);
  }, [paused, rows.length]);

  return (
    <div ref={rootRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-black via-[#0c0c0c] to-[#1a1a1a]" />
      <div
        className="relative will-change-transform"
        style={{
          paddingTop: SKILL_REEL_HIGHLIGHT_TOP_PX,
          paddingLeft: SKILL_REEL_SHIFT_PX,
          transform: `translate3d(0, ${-index * SKILL_REEL_ROW_PX}px, 0)`,
          transition: paused || instant ? "none" : `transform ${SKILL_REEL_MOVE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
        }}
      >
        {rows.map((skill, i) => {
          const focused = i === index;
          return (
            <div
              key={`${skill.id}-${i}`}
              className="flex items-center gap-2.5 px-3"
              style={{
                height: SKILL_REEL_ROW_PX,
                transform: focused ? "translateX(10px) scale(1.08)" : "translateX(0) scale(1)",
                transformOrigin: "center left",
                transition: `transform ${SKILL_REEL_MOVE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)`,
              }}
            >
              <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md bg-white/10 ring-1 ring-white/10">
                {skill.thumb ? (
                  <img
                    src={skill.thumb}
                    alt=""
                    width={28}
                    height={28}
                    className="h-7 w-7 object-cover"
                  />
                ) : null}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-N900">
                {skill.title}
              </span>
            </div>
          );
        })}
      </div>
      <div
        className="absolute rounded-lg bg-white/[0.06] ring-1 ring-white/20"
        style={{
          top: SKILL_REEL_HIGHLIGHT_TOP_PX,
          height: SKILL_REEL_ROW_PX,
          left: SKILL_REEL_SHIFT_PX + 12,
          right: 12,
        }}
      />
      <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-black to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[4.5rem] bg-gradient-to-t from-black via-black/70 to-transparent" />
    </div>
  );
}

const CANVAS_HERO_CAPS = ["Add a node", "Connect a wire", "Generate the graph"] as const;

function CanvasHeroNode({
  label,
  icon: Icon,
  className,
}: {
  label: string;
  icon: LucideIcon;
  className: string;
}) {
  return (
    <div className={`canvas-hero-node canvas-hero-anim absolute ${className}`}>
      <div className="flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.06] px-2 py-1.5 shadow-lg shadow-black/40 ring-1 ring-white/5">
        <Icon className="h-3 w-3 text-N900/80" />
        <span className="text-[10px] font-semibold tracking-wide text-N900">{label}</span>
      </div>
    </div>
  );
}

function CanvasHeroGraph() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-black via-[#0c0c0c] to-[#1a1a1a]" />
      <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-black to-transparent" />
      <div className="absolute inset-y-0 left-0 w-[45%] bg-gradient-to-r from-black via-black/70 to-transparent" />

      <div className="absolute left-1/2 top-[42%] h-[118px] w-[280px] -translate-x-1/2 -translate-y-1/2">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 280 118" fill="none">
          <path
            d="M78 36 C120 30, 148 24, 176 28"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth="1.5"
          />
          <path
            d="M214 50 C216 74, 176 84, 154 90"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth="1.5"
          />
          <path
            className="canvas-hero-wire canvas-hero-wire-1 canvas-hero-anim"
            d="M78 36 C120 30, 148 24, 176 28"
            stroke="#F26522"
            strokeWidth="1.75"
            strokeLinecap="round"
            pathLength={1}
          />
          <path
            className="canvas-hero-wire canvas-hero-wire-2 canvas-hero-anim"
            d="M214 50 C216 74, 176 84, 154 90"
            stroke="#F26522"
            strokeWidth="1.75"
            strokeLinecap="round"
            pathLength={1}
          />
          <circle className="canvas-hero-packet canvas-hero-packet-1 canvas-hero-anim" r="2.4" fill="#FF995A" />
          <circle className="canvas-hero-packet canvas-hero-packet-2 canvas-hero-anim" r="2.4" fill="#FF995A" />
        </svg>

        <CanvasHeroNode label="Text" icon={Type} className="canvas-hero-n1 left-[6px] top-[22px]" />
        <CanvasHeroNode label="Image" icon={ImageIcon} className="canvas-hero-n2 left-[168px] top-[12px]" />
        <CanvasHeroNode label="Video" icon={Video} className="canvas-hero-n3 left-[96px] top-[76px]" />
      </div>

      <div className="absolute bottom-3 right-3 z-[1] h-4 w-[200px]">
        {CANVAS_HERO_CAPS.map((cap, i) => (
          <span
            key={cap}
            className={`canvas-hero-cap canvas-hero-cap-${i + 1} canvas-hero-anim absolute inset-x-0 top-0 text-right text-[11px] font-medium tracking-wide text-N900/80`}
          >
            {cap}
          </span>
        ))}
      </div>
    </div>
  );
}

function HeroPanel({
  children,
  colors,
  href,
  badge,
  backdrop,
  className = "",
}: {
  children: React.ReactNode;
  colors?: [string, string, string];
  href?: string;
  badge?: string;
  backdrop?: React.ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      {colors ? (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <Grainient
            color1={colors[0]}
            color2={colors[1]}
            color3={colors[2]}
            {...GRAINIENT}
          />
        </div>
      ) : null}
      {backdrop}
      {badge ? (
        <span className="absolute right-4 top-4 z-10 rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-N900">
          {badge}
        </span>
      ) : null}
      <div className="relative z-10 flex h-full min-h-[168px] flex-col justify-end gap-3 p-5">
        {children}
      </div>
    </>
  );

  const panelClass = colors
    ? "relative flex h-full min-h-[168px] overflow-hidden rounded-radius-xl bg-N50"
    : "relative flex h-full min-h-[168px] overflow-hidden rounded-radius-xl bg-N100";

  if (href) {
    return (
      <Link href={href} className={`group ${panelClass} ${className} transition hover:brightness-110`}>
        {inner}
      </Link>
    );
  }

  return <div className={`${panelClass} ${className}`}>{inner}</div>;
}

export default function DashboardHero() {
  return (
    <SkillsCatalogProvider>
    <section className="mb-16 hidden md:block">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <HeroPanel colors={["#FF995A", "#F26522", "#B24610"]}>
          <h2 className="font-display text-balance text-2xl font-bold tracking-tight text-N900 sm:text-3xl">
            Create without limits
          </h2>
        </HeroPanel>

        <HeroPanel href="/tools/skills" badge="New" backdrop={<SkillsHeroReel />}>
          <Sparkles className="h-5 w-5 text-N900/80" />
          <h3 className="font-display text-xl font-bold tracking-tight text-N900">Skills</h3>
        </HeroPanel>

        <HeroPanel href="/tools/canvas" badge="New" backdrop={<CanvasHeroGraph />}>
          <Workflow className="h-5 w-5 text-N900/80" />
          <h3 className="font-display text-xl font-bold tracking-tight text-N900">Canvas</h3>
        </HeroPanel>
      </div>

      <div className="relative mt-4 overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-10 w-10 bg-gradient-to-r from-N50 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-10 w-10 bg-gradient-to-l from-N50 to-transparent"
        />
        <div className="hero-marquee flex w-max items-center gap-10 whitespace-nowrap pr-10 text-xs text-text-secondary">
          {[...TICKER, ...TICKER].map((item, i) => {
            const Icon = item.icon;
            return (
              <span key={i} className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 text-text-disabled" />
                {item.text}
              </span>
            );
          })}
        </div>
      </div>

      <style>{`
        @keyframes heroMarquee {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        .hero-marquee {
          animation: heroMarquee 32s linear infinite;
          will-change: transform;
          transform: translateZ(0);
        }
        @media (prefers-reduced-motion: reduce) {
          .hero-marquee {
            animation: none !important;
          }
        }

        @keyframes canvasHeroCap1 {
          0%, 26%, 100% { opacity: 1; }
          32%, 94% { opacity: 0; }
        }
        @keyframes canvasHeroCap2 {
          0%, 28%, 60%, 100% { opacity: 0; }
          32%, 56% { opacity: 1; }
        }
        @keyframes canvasHeroCap3 {
          0%, 58%, 94%, 100% { opacity: 0; }
          62%, 88% { opacity: 1; }
        }
        @keyframes canvasHeroNode1 {
          0%, 22% { transform: scale(1.08); box-shadow: 0 0 0 1px rgba(242,101,34,0.55); }
          30%, 100% { transform: scale(1); box-shadow: 0 0 0 0 transparent; }
        }
        @keyframes canvasHeroNode2 {
          0%, 24% { transform: scale(1); box-shadow: 0 0 0 0 transparent; }
          32%, 54% { transform: scale(1.08); box-shadow: 0 0 0 1px rgba(242,101,34,0.55); }
          62%, 100% { transform: scale(1); box-shadow: 0 0 0 0 transparent; }
        }
        @keyframes canvasHeroNode3 {
          0%, 54% { transform: scale(1); box-shadow: 0 0 0 0 transparent; }
          62%, 86% { transform: scale(1.08); box-shadow: 0 0 0 1px rgba(242,101,34,0.55); }
          94%, 100% { transform: scale(1); box-shadow: 0 0 0 0 transparent; }
        }
        @keyframes canvasHeroWire1 {
          0% { stroke-dashoffset: 1; opacity: 0; }
          8% { opacity: 1; }
          26% { stroke-dashoffset: 0; opacity: 1; }
          88% { stroke-dashoffset: 0; opacity: 0.85; }
          96%, 100% { stroke-dashoffset: 1; opacity: 0; }
        }
        @keyframes canvasHeroWire2 {
          0%, 32% { stroke-dashoffset: 1; opacity: 0; }
          38% { opacity: 1; }
          56% { stroke-dashoffset: 0; opacity: 1; }
          88% { stroke-dashoffset: 0; opacity: 0.85; }
          96%, 100% { stroke-dashoffset: 1; opacity: 0; }
        }
        @keyframes canvasHeroPacket1 {
          0%, 8% { offset-distance: 0%; opacity: 0; }
          12% { opacity: 1; }
          26% { offset-distance: 100%; opacity: 1; }
          32%, 100% { offset-distance: 100%; opacity: 0; }
        }
        @keyframes canvasHeroPacket2 {
          0%, 36% { offset-distance: 0%; opacity: 0; }
          40% { opacity: 1; }
          56% { offset-distance: 100%; opacity: 1; }
          62%, 100% { offset-distance: 100%; opacity: 0; }
        }
        .canvas-hero-cap { opacity: 0; }
        .canvas-hero-cap-1 { animation: canvasHeroCap1 10s ease-in-out infinite; }
        .canvas-hero-cap-2 { animation: canvasHeroCap2 10s ease-in-out infinite; }
        .canvas-hero-cap-3 { animation: canvasHeroCap3 10s ease-in-out infinite; }
        .canvas-hero-n1 { animation: canvasHeroNode1 10s ease-in-out infinite; transform-origin: center center; border-radius: 8px; }
        .canvas-hero-n2 { animation: canvasHeroNode2 10s ease-in-out infinite; transform-origin: center center; border-radius: 8px; }
        .canvas-hero-n3 { animation: canvasHeroNode3 10s ease-in-out infinite; transform-origin: center center; border-radius: 8px; }
        .canvas-hero-wire {
          stroke-dasharray: 1;
          stroke-dashoffset: 1;
          filter: drop-shadow(0 0 4px rgba(242, 101, 34, 0.7));
        }
        .canvas-hero-wire-1 { animation: canvasHeroWire1 10s ease-in-out infinite; }
        .canvas-hero-wire-2 { animation: canvasHeroWire2 10s ease-in-out infinite; }
        .canvas-hero-packet { opacity: 0; }
        .canvas-hero-packet-1 {
          offset-path: path("M78 36 C120 30, 148 24, 176 28");
          animation: canvasHeroPacket1 10s ease-in-out infinite;
        }
        .canvas-hero-packet-2 {
          offset-path: path("M214 50 C216 74, 176 84, 154 90");
          animation: canvasHeroPacket2 10s ease-in-out infinite;
        }
        .group:hover .canvas-hero-anim {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .canvas-hero-anim {
            animation: none !important;
          }
          .canvas-hero-cap-1 { opacity: 1; }
          .canvas-hero-wire {
            stroke-dashoffset: 0;
            opacity: 0.7;
          }
        }
      `}</style>
    </section>
    </SkillsCatalogProvider>
  );
}
