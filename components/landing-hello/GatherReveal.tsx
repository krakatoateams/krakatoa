"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

/**
 * "Gather" scroll reveal: panels start pushed outward from their grid slots
 * (offset + slightly scaled down + faded) and converge into place, staggered,
 * once the grid scrolls into view. No animation lib — a shared Intersection
 * Observer on the grid flips a boolean the items read via context. Honours
 * prefers-reduced-motion by rendering everything settled.
 */
const GatherContext = createContext(false);

export function GatherGrid({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
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
      { threshold: 0.2 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={ref} className={className}>
      <GatherContext.Provider value={shown}>{children}</GatherContext.Provider>
    </div>
  );
}

export function GatherItem({
  from,
  delay = 0,
  duration = 850,
  className,
  children,
}: {
  /** Starting transform, e.g. "translate3d(-40px, 20px, 0) scale(0.96)". */
  from: string;
  delay?: number;
  duration?: number;
  className?: string;
  children: ReactNode;
}) {
  const shown = useContext(GatherContext);

  const style: CSSProperties = {
    opacity: shown ? 1 : 0,
    transform: shown ? "none" : from,
    transition: `opacity ${duration}ms cubic-bezier(0.22,1,0.36,1) ${delay}ms, transform ${duration}ms cubic-bezier(0.22,1,0.36,1) ${delay}ms`,
    willChange: "transform, opacity",
  };

  return (
    <div className={className} style={style}>
      {children}
    </div>
  );
}
