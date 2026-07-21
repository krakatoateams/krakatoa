"use client";

import { useEffect, useState } from "react";

// Glassy floating tooltip bubble shown above its anchor. The anchor's wrapper
// must be position:relative. Always rendered (so it can fade) but inert when
// hidden. Visibility is driven by the caller's hover/focus state.
export function TooltipBubble({ label, show }: { label: string; show: boolean }) {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute bottom-full left-1/2 z-[80] mb-2 w-max max-w-[260px] -translate-x-1/2 rounded-xl border border-white/10 bg-[#0b1020]/95 px-3 py-2 text-center text-xs font-medium leading-snug text-gray-200 shadow-2xl shadow-black/60 backdrop-blur-md transition-all duration-150 ${
        show ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      {label}
      <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/10 bg-[#0b1020]/95" />
    </span>
  );
}

// Wraps any element with a hover/focus tooltip. Use for plain buttons; the
// ChipDropdown has its own built-in tooltip support via the `tooltip` prop.
export function Tooltip({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  /** Extra classes for the wrapper (e.g. to let the anchor grow: "flex-1"). */
  className?: string;
}) {
  const [show, setShow] = useState(false);
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
    <div
      className={`relative inline-flex ${className}`}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocusCapture={() => setShow(true)}
      onBlurCapture={() => setShow(false)}
    >
      {children}
      {!isMobile && <TooltipBubble label={label} show={show} />}
    </div>
  );
}
