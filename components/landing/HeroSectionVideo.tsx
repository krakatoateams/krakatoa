"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HeroLayout } from "./HeroSection";

const R2_BASE = "https://pub-30197c9faf284e5e852ce7d61364972c.r2.dev";

const VIDEO_FILES = [
  "Badminton (GPT).mp4",
  "Car Racing 1 (Seedence).mp4",
  "Car Racing 2 (seedence).mp4",
  "Dinosaur (Kling).mp4",
];

const VIDEO_SRCS = VIDEO_FILES.map(
  (name) => `${R2_BASE}/${encodeURIComponent(name)}`
);

/**
 * Plays a playlist of background clips one after another with a soft
 * crossfade. Only the current and next clip are preloaded so the hero
 * doesn't pull every video at once.
 */
function VideoBackdrop({ srcs }: { srcs: string[] }) {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLVideoElement | null)[]>([]);
  const nextIndex = (active + 1) % srcs.length;

  const advance = useCallback(() => {
    setActive((prev) => (prev + 1) % srcs.length);
  }, [srcs.length]);

  useEffect(() => {
    const el = refs.current[active];
    if (!el) return;
    el.currentTime = 0;
    const play = el.play();
    if (play) play.catch(() => {});
  }, [active]);

  return (
    <div className="absolute inset-0 z-0 overflow-hidden">
      {srcs.map((src, i) => (
        <video
          key={src}
          ref={(el) => {
            refs.current[i] = el;
          }}
          src={src}
          muted
          playsInline
          autoPlay={i === 0}
          preload={i === active || i === nextIndex ? "auto" : "none"}
          onEnded={i === active ? advance : undefined}
          aria-hidden
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-1000 ${
            i === active ? "opacity-100" : "opacity-0"
          }`}
        />
      ))}
      {/* Darkening overlay for contrast — sits above the clips, below content */}
      <div className="absolute inset-0 bg-black/40" aria-hidden />
    </div>
  );
}

export function HeroSectionVideoA() {
  return (
    <HeroLayout tone="light" background={<VideoBackdrop srcs={VIDEO_SRCS} />} />
  );
}
