"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Scroll-triggered, word-by-word fade-up reveal — a no-dependency stand-in for
 * the split-text animations on reference sites. Words share a single
 * transition and stagger via per-word delay so the line "types" itself in as it
 * enters the viewport. Honours prefers-reduced-motion by rendering fully shown.
 */
export function RevealText({
  text,
  className,
  style,
  stagger = 28,
  duration = 620,
}: {
  text: string;
  className?: string;
  style?: CSSProperties;
  /** Delay added per word, in ms. */
  stagger?: number;
  /** Per-word transition duration, in ms. */
  duration?: number;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setShown(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setShown(true);
          observer.disconnect();
        }
      },
      { threshold: 0.25 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const words = text.split(" ");

  return (
    <p ref={ref} className={className} style={style}>
      {words.map((word, i) => (
        <span
          key={`${word}-${i}`}
          className="inline-block will-change-[transform,opacity]"
          style={{
            opacity: shown ? 1 : 0,
            transform: shown ? "translateY(0)" : "translateY(0.5em)",
            transition: `opacity ${duration}ms cubic-bezier(0.22,1,0.36,1) ${
              i * stagger
            }ms, transform ${duration}ms cubic-bezier(0.22,1,0.36,1) ${
              i * stagger
            }ms`,
          }}
        >
          {word}
          {i < words.length - 1 ? "\u00a0" : ""}
        </span>
      ))}
    </p>
  );
}
