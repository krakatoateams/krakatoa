"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Plays a playlist of background clips one after another with a soft
 * crossfade. Only the current and next clip are preloaded so the hero
 * doesn't pull every video at once.
 */
export function VideoBackdrop({
  srcs,
  overlayClassName = "bg-black/40",
  activeIndex,
  onActiveIndexChange,
}: {
  srcs: string[];
  /** Darkening layer above the clips, below the hero content. */
  overlayClassName?: string;
  /** Pass to drive the playlist from outside; omit to self-advance. */
  activeIndex?: number;
  onActiveIndexChange?: (index: number) => void;
}) {
  const [internalActive, setInternalActive] = useState(0);
  const controlled = activeIndex != null;
  const active = controlled ? activeIndex : internalActive;
  const refs = useRef<(HTMLVideoElement | null)[]>([]);
  const nextIndex = (active + 1) % srcs.length;

  const advance = useCallback(() => {
    const next = (active + 1) % srcs.length;
    if (controlled) onActiveIndexChange?.(next);
    else setInternalActive(next);
  }, [active, srcs.length, controlled, onActiveIndexChange]);

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
      <div className={`absolute inset-0 ${overlayClassName}`} aria-hidden />
    </div>
  );
}
