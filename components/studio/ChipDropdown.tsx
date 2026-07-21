"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import type { ChipOption } from "./types";
import { TooltipBubble } from "./Tooltip";

// Unified studio chip selector. The menu is rendered in a portal (fixed
// coordinates) so it can never be clipped by a horizontally-scrolling chip row,
// and it repositions on scroll/resize. Supports:
//  - `fluid`   : stretch the chip to fill the container width on mobile (auto on sm+)
//  - `bare`    : borderless trigger (just value + chevron) — used for inline Model rows
//  - `tooltip` : hover/focus tooltip bubble above the trigger
//  - `square`  : square corners instead of pill
// The menu sizes to its content, bounded to 224–288px, so both tools keep their
// original menu widths without per-call configuration.
const MENU_MAX_WIDTH = 288;

export function ChipDropdown({
  icon,
  value,
  options,
  activeId,
  onSelect,
  disabled,
  square = false,
  showChevron = true,
  fluid = false,
  bare = false,
  tooltip,
  sheetTitle,
}: {
  icon: React.ReactNode;
  value: string;
  options: ChipOption[];
  activeId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  square?: boolean;
  showChevron?: boolean;
  /** On mobile, stretch the chip to fill the container width (auto on sm+). */
  fluid?: boolean;
  /** Borderless trigger (just value + chevron) — used for the inline Model row. */
  bare?: boolean;
  /** Hover/focus tooltip bubble above the trigger. */
  tooltip?: string;
  /** Title shown at the top of the mobile bottom sheet (e.g. "Select video ratio"). */
  sheetTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sheetShown, setSheetShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

  // Track the mobile breakpoint (< md) so the menu can present as a bottom sheet.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Lock body scroll while the mobile sheet is open, and drive the slide-up.
  useEffect(() => {
    if (!open || !isMobile) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => setSheetShown(true));
    return () => {
      document.body.style.overflow = prev;
      cancelAnimationFrame(raf);
      setSheetShown(false);
    };
  }, [open, isMobile]);

  // Anchor the portal menu under the trigger using viewport (fixed) coordinates
  // and keep it in place while scrolling/resizing.
  const positionMenu = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_MAX_WIDTH - 8));
    setCoords({ top: r.bottom + 8, left });
  }, []);

  const toggle = () => {
    if (open) {
      setOpen(false);
    } else {
      positionMenu();
      setOpen(true);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        ref.current &&
        !ref.current.contains(t) &&
        (!menuRef.current || !menuRef.current.contains(t))
      ) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const reposition = () => positionMenu();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open, positionMenu]);

  // One option row, shared by the desktop dropdown and the mobile sheet.
  const renderOption = (opt: ChipOption, big: boolean) => {
    const active = opt.id === activeId;
    return (
      <button
        key={opt.id}
        type="button"
        onClick={() => {
          onSelect(opt.id);
          setOpen(false);
        }}
        className={`flex w-full items-center justify-between gap-3 rounded-xl text-left text-sm transition-colors ${
          big ? "px-4 py-3" : "px-3 py-2"
        } ${active ? "bg-purple-500/20 text-gray-100" : "text-gray-400 hover:bg-white/5"}`}
      >
        <span className="flex items-center gap-2">
          {opt.label}
          {opt.hint && (
            <span className="text-xs font-medium text-purple-300">{opt.hint}</span>
          )}
        </span>
        {active && <Check className="h-4 w-4 shrink-0 text-purple-400" />}
      </button>
    );
  };

  return (
    <div
      ref={ref}
      className={`relative shrink-0 ${fluid ? "w-full sm:w-auto" : ""}`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setHover(true)}
      onBlurCapture={() => setHover(false)}
    >
      {tooltip && !isMobile && (
        <TooltipBubble label={tooltip} show={hover && !open && !disabled} />
      )}
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={
          bare
            ? `flex items-center gap-1.5 text-sm font-semibold transition-colors disabled:opacity-40 ${
                open ? "text-white" : "text-gray-100 hover:text-white"
              }`
            : `flex h-10 items-center gap-2 px-3 text-sm transition-colors disabled:opacity-40 ${
                square ? "" : "border"
              } ${fluid ? "w-full justify-between sm:w-auto sm:justify-start" : ""} ${
                square ? "rounded-[4px]" : "rounded-full"
              } ${
                square
                  ? open
                    ? "bg-purple-500/15 text-white"
                    : "bg-white/5 text-gray-200 hover:bg-white/10"
                  : open
                    ? "border-purple-400/50 bg-purple-500/15 text-white"
                    : "border-white/10 bg-white/5 text-gray-200 hover:border-white/25"
              }`
        }
      >
        {!bare && <span className="text-purple-300">{icon}</span>}
        <span className="font-semibold">{value}</span>
        {showChevron && (
          <ChevronDown
            className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {/* Desktop: anchored dropdown menu under the trigger. */}
      {open &&
        !isMobile &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: coords.top, left: coords.left }}
            className="z-[80] w-max min-w-[14rem] max-w-[18rem] overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020] p-1.5 shadow-2xl shadow-black/50"
          >
            {options.map((opt) => renderOption(opt, false))}
          </div>,
          document.body
        )}

      {/* Mobile: bottom sheet. */}
      {open &&
        isMobile &&
        typeof document !== "undefined" &&
        createPortal(
          <>
            <div
              onClick={() => setOpen(false)}
              aria-hidden="true"
              className={`fixed inset-0 z-[90] bg-black/60 backdrop-blur-sm transition-opacity duration-200 ${
                sheetShown ? "opacity-100" : "opacity-0"
              }`}
            />
            <div
              ref={menuRef}
              role="dialog"
              aria-modal="true"
              className={`fixed inset-x-0 bottom-0 z-[90] rounded-t-2xl border-t border-white/10 bg-[#0b1020] p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-2xl shadow-black/60 transition-transform duration-200 ease-out ${
                sheetShown ? "translate-y-0" : "translate-y-full"
              }`}
            >
              <div className="mx-auto mb-2 mt-1 h-1.5 w-10 rounded-full bg-white/20" />
              <p className="mb-2 px-3 text-lg font-semibold text-white">
                {sheetTitle ?? "Select an option"}
              </p>
              <div className="max-h-[70vh] overflow-y-auto">
                {options.map((opt) => renderOption(opt, true))}
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
