"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drives a scroll-pinned showcase: attach `outerRef` to a tall wrapper holding
 * a `sticky` child, and scroll progress through that wrapper maps to an index
 * from 0 to count-1.
 */
export function usePinnedScrollIndex(count: number) {
  const outerRef = useRef<HTMLElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    let rafId = 0;
    const onScroll = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        const el = outerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const denom = rect.height - window.innerHeight;
        if (denom <= 0) return;
        const progress = Math.min(Math.max(-rect.top / denom, 0), 1);
        const idx = Math.min(Math.floor(progress * count), count - 1);
        setActiveIndex((prev) => (prev === idx ? prev : idx));
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [count]);

  const scrollToIndex = useCallback(
    (index: number) => {
      const el = outerRef.current;
      if (!el) return;
      const denom = el.offsetHeight - window.innerHeight;
      // Aim for the middle of each step so the index "lands" cleanly.
      const targetProgress = (index + 0.5) / count;
      const top = el.offsetTop + targetProgress * denom;
      const reduce =
        typeof window !== "undefined" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top, behavior: reduce ? "auto" : "smooth" });
    },
    [count]
  );

  return { outerRef, activeIndex, scrollToIndex };
}
