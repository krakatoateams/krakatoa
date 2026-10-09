"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import type { ChipOption } from "./types";
import { TooltipBubble, useTooltipGate } from "./Tooltip";

// Unified studio chip selector. The menu is rendered in a portal (fixed
// coordinates) so it can never be clipped by a horizontally-scrolling chip row,
// and it repositions on scroll/resize. Supports:
//  - `fluid`   : stretch the chip to fill the container width on mobile (auto on sm+)
//  - `bare`    : borderless trigger (just value + chevron) — used for inline Model rows
//  - `tooltip` : hover/focus tooltip bubble above the trigger
//  - `square`  : in-form param chip (radius-sm, no border, no chevron) — always
//                use this for chips inside the omni card. Header chips omit it.
// The menu sizes to its content, bounded to 224–288px, so both tools keep their
// original menu widths without per-call configuration.
const MENU_MAX_WIDTH = 288;

// The app-wide `capitalize` on buttons would render the minor word "to" as "To"
// (e.g. "Storyboard to video" → "Storyboard To Video"). Wrap any standalone "to"
// in a `lowercase` span so it overrides the parent capitalize and stays "to".
function withMinorWordCase(label: string): React.ReactNode {
  if (!/\bto\b/i.test(label)) return label;
  return label.split(/\b(to)\b/i).map((part, i) =>
    /^to$/i.test(part) ? (
      <span key={i} className="lowercase">
        {part}
      </span>
    ) : (
      part
    )
  );
}

export function ChipDropdown({
  icon,
  value,
  options,
  activeId,
  onSelect,
  disabled,
  square = false,
  showChevron,
  fluid = false,
  bare = false,
  tooltip,
  sheetTitle,
  dimValue = false,
  field = false,
}: {
  icon: React.ReactNode;
  value: string;
  options: ChipOption[];
  activeId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  square?: boolean;
  showChevron?: boolean;
  /** Render the value with less emphasis (placeholder look) — e.g. an unset "Auto" param. */
  dimValue?: boolean;
  /** On mobile, stretch the chip to fill the container width (auto on sm+). */
  fluid?: boolean;
  /** Borderless trigger (just value + chevron) — used for the inline Model row. */
  bare?: boolean;
  /** Hover/focus tooltip bubble above the trigger. */
  tooltip?: string;
  /** Title shown at the top of the mobile bottom sheet (e.g. "Select video ratio"). */
  sheetTitle?: string;
  /** Form-field presentation: full-width, input-height trigger with the value left and chevron right. */
  field?: boolean;
}) {
  const showTriggerChevron = showChevron ?? !square;
  const [open, setOpen] = useState(false);
  const { on: hover, bind: tooltipBind } = useTooltipGate();
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

  const closeAndFocusTrigger = () => {
    setOpen(false);
    btnRef.current?.focus();
  };

  // Move focus into the menu (selected option, else first) once it is open.
  useEffect(() => {
    if (!open) return;
    const raf = requestAnimationFrame(() => {
      const opts = menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]');
      const target = menuRef.current?.querySelector<HTMLElement>('[aria-selected="true"]') ?? opts?.[0];
      target?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(raf);
  }, [open, isMobile]);

  // Arrow/Home/End navigation inside the menu. Escape and Tab close only the
  // menu; stopPropagation keeps a parent dialog's Escape handler from firing
  // (React events bubble through portals).
  const onMenuKeyDown = (e: React.KeyboardEvent) => {
    const opts = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? []
    );
    const i = opts.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      opts[(n + opts.length) % opts.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i < 0 ? opts.length - 1 : i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(opts.length - 1);
    else if (e.key === "Escape") {
      e.stopPropagation();
      closeAndFocusTrigger();
    } else if (e.key === "Tab") closeAndFocusTrigger(); // default Tab then moves on from the trigger
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
        role="option"
        aria-selected={active}
        tabIndex={-1}
        onClick={() => {
          onSelect(opt.id);
          closeAndFocusTrigger();
        }}
        className={`flex w-full items-center justify-between gap-3 rounded-xl text-left text-sm outline-none transition-colors focus-visible:bg-white/10 ${
          big ? "px-4 py-3" : "px-3 py-2"
        } ${active ? "bg-white/15 text-text-primary" : "text-text-secondary hover:bg-white/5"}`}
      >
        <span className="min-w-0 flex-1 truncate">{withMinorWordCase(opt.label)}</span>
        {opt.hint && (
          <span
            className={`shrink-0 tabular-nums text-xs font-medium sm:text-sm ${
              opt.hint === "Soon" ? "text-warning" : "text-text-secondary"
            }`}
          >
            {opt.hint}
          </span>
        )}
        {active && <Check className="h-4 w-4 shrink-0 text-text-secondary" />}
      </button>
    );
  };

  return (
    <div
      ref={ref}
      className={`relative shrink-0 ${field ? "w-full" : fluid ? "w-full sm:w-auto" : ""}`}
      {...tooltipBind}
    >
      {tooltip && !isMobile && (
        <TooltipBubble label={tooltip} show={hover && !open && !disabled} />
      )}
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !open) {
            e.preventDefault();
            positionMenu();
            setOpen(true);
          }
        }}
        className={
          field
            ? `flex h-9 w-full items-center justify-between gap-2 rounded-lg bg-white/10 px-3 text-sm text-text-primary outline-none transition-colors hover:bg-white/15 focus-visible:ring-1 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-40 ${
                open ? "bg-white/15" : ""
              }`
            : bare
            ? `flex items-center gap-1.5 text-sm font-semibold transition-colors disabled:opacity-40 ${
                open ? "text-N900" : "text-text-primary hover:text-N900"
              }`
            : `flex h-10 items-center gap-2 px-3 text-sm transition-colors disabled:opacity-40 ${
                square ? "" : "border"
              } ${fluid ? "w-full justify-between sm:w-auto sm:justify-start" : ""} ${
                square ? "rounded-radius-sm" : "rounded-radius-xl"
              } ${
                square
                  ? open
                    ? "bg-white/10 text-N900"
                    : "bg-white/5 text-text-primary hover:bg-white/10"
                  : open
                    ? "border-white/30 bg-white/10 text-N900"
                    : "border-white/10 bg-white/5 text-text-primary hover:border-white/25"
              }`
        }
      >
        {!bare && !field && <span className="text-text-secondary">{icon}</span>}
        <span className={`font-semibold ${dimValue ? "text-text-disabled" : ""}`}>
          {withMinorWordCase(value)}
        </span>
        {showTriggerChevron && (
          <ChevronDown
            className={`h-3.5 w-3.5 text-text-secondary transition-transform ${open ? "rotate-180" : ""}`}
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
            role="listbox"
            onKeyDown={onMenuKeyDown}
            style={{ position: "fixed", top: coords.top, left: coords.left }}
            className="z-[80] max-h-[60vh] w-max min-w-[14rem] max-w-[18rem] overflow-y-auto overflow-x-hidden rounded-2xl border border-white/10 bg-N50 p-1.5 shadow-2xl shadow-N0/50"
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
              className={`fixed inset-0 z-[90] bg-N0/60 backdrop-blur-sm transition-opacity duration-200 ${
                sheetShown ? "opacity-100" : "opacity-0"
              }`}
            />
            <div
              ref={menuRef}
              role="dialog"
              aria-modal="true"
              onKeyDown={onMenuKeyDown}
              className={`fixed inset-x-0 bottom-0 z-[90] rounded-t-2xl border-t border-white/10 bg-N50 p-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)] shadow-2xl shadow-N0/60 transition-transform duration-200 ease-out ${
                sheetShown ? "translate-y-0" : "translate-y-full"
              }`}
            >
              <div className="mx-auto mb-2 mt-1 h-1.5 w-10 rounded-full bg-white/20" />
              <p className="mb-2 px-3 text-lg font-semibold text-N900">
                {sheetTitle ?? "Select an option"}
              </p>
              <div role="listbox" className="max-h-[70vh] overflow-y-auto">
                {options.map((opt) => renderOption(opt, true))}
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
