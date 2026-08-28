"use client";

import { useEffect, useRef, useState, type FocusEvent, type HTMLAttributes } from "react";

// Glassy floating tooltip bubble shown above its anchor. The anchor's wrapper
// must be position:relative. Always rendered (so it can fade) but inert when
// hidden. Visibility is driven by the caller's hover/focus state.
// `normal-case` matters: several anchors are section labels with their own
// text-transform, which the bubble would otherwise inherit and shout its prose.
export type TooltipAlign = "center" | "start" | "end";

const TOOLTIP_ALIGN: Record<
  TooltipAlign,
  { bubble: string; caret: string }
> = {
  center: {
    bubble: "left-1/2 -translate-x-1/2",
    caret: "left-1/2 -translate-x-1/2",
  },
  start: {
    bubble: "left-0",
    caret: "left-3",
  },
  end: {
    bubble: "right-0",
    caret: "right-3",
  },
};

export function TooltipBubble({
  label,
  show,
  align = "center",
}: {
  label: string;
  show: boolean;
  align?: TooltipAlign;
}) {
  const pos = TOOLTIP_ALIGN[align];
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute bottom-full z-[80] mb-2 w-max max-w-[260px] rounded-xl border border-white/10 bg-N50/95 px-3 py-2 text-center text-sm font-medium normal-case leading-snug text-text-primary shadow-2xl shadow-N0/60 backdrop-blur-md transition-all duration-150 ${pos.bubble} ${
        show ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      {label}
      <span
        className={`absolute top-full h-2 w-2 -translate-y-1/2 rotate-45 border-b border-r border-white/10 bg-N50/95 ${pos.caret}`}
      />
    </span>
  );
}

// Hover + keyboard-focus tooltip gate. Mouse click must not leave the bubble
// stuck: clicking focuses the chip, the dropdown portal then steals/restores
// that focus, and a raw onFocusCapture would re-show the tooltip with the
// cursor already gone (mouseleave already fired, so it never fires again).
export function useTooltipGate(): {
  on: boolean;
  bind: Pick<
    HTMLAttributes<HTMLElement>,
    "onMouseEnter" | "onMouseLeave" | "onPointerDown" | "onFocusCapture" | "onBlurCapture"
  >;
} {
  const [on, setOn] = useState(false);
  const suppressFocus = useRef(false);

  return {
    on,
    bind: {
      onMouseEnter: () => {
        suppressFocus.current = false;
        setOn(true);
      },
      onMouseLeave: () => setOn(false),
      onPointerDown: () => {
        suppressFocus.current = true;
        setOn(false);
      },
      onFocusCapture: (e: FocusEvent) => {
        if (suppressFocus.current) return;
        if ((e.target as HTMLElement).matches(":focus-visible")) setOn(true);
      },
      onBlurCapture: () => setOn(false),
    },
  };
}

// Wraps any element with a hover/focus tooltip. Use for plain buttons; the
// ChipDropdown has its own built-in tooltip support via the `tooltip` prop.
export function Tooltip({
  label,
  children,
  className = "",
  align = "center",
}: {
  label: string;
  children: React.ReactNode;
  /** Extra classes for the wrapper (e.g. to let the anchor grow: "flex-1"). */
  className?: string;
  /** Pin the bubble when the anchor sits flush to a modal edge (avoids clipping). */
  align?: TooltipAlign;
}) {
  const { on, bind } = useTooltipGate();
  const [isMobile, setIsMobile] = useState(false);

  // Tooltips are hover/focus-based, so skip rendering them on mobile/touch.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return (
    <div className={`relative inline-flex ${className}`} {...bind}>
      {children}
      {!isMobile && <TooltipBubble label={label} show={on} align={align} />}
    </div>
  );
}
