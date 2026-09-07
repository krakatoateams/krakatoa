"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles } from "lucide-react";
import { isAgentSkill, skillHref, type Skill, type SkillId } from "@/lib/skills";
import { SkillsGrid } from "./SkillsGrid";
import { useSkillsCatalog } from "./SkillsCatalogProvider";

const FORM_GAP = 24;

export default function SkillPicker({
  value,
  activeId,
  onSelectSkill,
  onOpenHandoff,
  disabled,
}: {
  value: string;
  activeId: SkillId | null;
  onSelectSkill: (id: SkillId) => void;
  onOpenHandoff: (href: string) => void;
  disabled?: boolean;
}) {
  const { skillById } = useSkillsCatalog();
  const [open, setOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [sheetShown, setSheetShown] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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

  const positionMenu = useCallback(() => {
    const btn = btnRef.current;
    if (!btn) return;
    const card = btn.closest("[data-studio-form-card]");
    const r = (card instanceof HTMLElement ? card : btn).getBoundingClientRect();
    const width = r.width;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const top = r.bottom + FORM_GAP;
    const maxHeight = Math.max(200, window.innerHeight - top - 16);
    setCoords({ top, left, width, maxHeight });
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
      const t = e.target as Node | null;
      if (t instanceof Element && t.closest("[data-skill-admin-edit]")) return;
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

  const pick = (skill: Skill) => {
    setOpen(false);
    if (skill.openHref) {
      onOpenHandoff(skillHref(skill.id));
      return;
    }
    if (isAgentSkill(skill)) onSelectSkill(skill.id);
  };

  const selected = activeId ? skillById(activeId) : undefined;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        disabled={disabled}
        onClick={toggle}
        className={`flex h-10 items-center gap-2 rounded-radius-sm text-sm transition-colors disabled:opacity-40 ${
          selected ? "py-1 pl-1.5 pr-3" : "px-3"
        } ${
          open
            ? "bg-white/10 text-N900"
            : "bg-white/5 text-text-primary hover:bg-white/10"
        }`}
      >
        {selected ? (
          <span className="relative h-7 w-7 shrink-0 overflow-hidden rounded-md bg-white/5">
            {/* Native img: next/image blanks on src swap (data-loaded-src fires once). */}
            <img
              key={selected.id}
              src={selected.thumb || undefined}
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 object-cover"
            />
          </span>
        ) : (
          <span className="text-text-secondary">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        )}
        <span className={`font-semibold ${selected ? "" : "text-text-disabled"}`}>{value}</span>
      </button>

      {open &&
        !isMobile &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: coords.width,
              maxHeight: coords.maxHeight,
            }}
            className="z-[80] overflow-y-auto overflow-x-hidden overscroll-contain rounded-2xl border border-white/10 bg-N50 p-5 shadow-2xl shadow-N0/50"
          >
            <SkillsGrid activeId={activeId} onSelect={pick} />
          </div>,
          document.body
        )}

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
              aria-label="Select skill"
              className={`fixed inset-x-0 bottom-0 z-[90] rounded-t-2xl border-t border-white/10 bg-N50 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] shadow-2xl shadow-N0/60 transition-transform duration-200 ease-out ${
                sheetShown ? "translate-y-0" : "translate-y-full"
              }`}
            >
              <div className="mx-auto mb-2 mt-1 h-1.5 w-10 rounded-full bg-white/20" />
              <p className="mb-4 px-1 text-lg font-semibold text-N900">Select skill</p>
              <div className="max-h-[70vh] overflow-y-auto">
                <SkillsGrid activeId={activeId} onSelect={pick} />
              </div>
            </div>
          </>,
          document.body
        )}
    </div>
  );
}
