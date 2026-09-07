"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  CalendarDays,
  Camera,
  Images,
  Plus,
  Scissors,
  Sparkles,
  Video,
  Workflow,
  X,
} from "lucide-react";
import type { ToolSidebarVisibility } from "@/lib/tool-configs-db";

const TOOL_MENU: {
  label: string;
  href: string;
  icon: typeof Camera;
  toolKey: string;
  exact?: boolean;
}[] = [
  { label: "Image", href: "/tools/photo-v2", icon: Camera, toolKey: "photo" },
  { label: "Video", href: "/tools/video", icon: Video, toolKey: "reels" },
  { label: "Skills", href: "/tools/skills", icon: Sparkles, toolKey: "skills" },
  { label: "Canvas", href: "/tools/canvas", icon: Workflow, toolKey: "canvas" },
  { label: "Editor", href: "/tools/editor", icon: Scissors, toolKey: "editor" },
  { label: "Scheduler", href: "/tools/scheduler", icon: CalendarClock, toolKey: "schedule", exact: true },
];

function isToolActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function DockCircle({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 text-text-primary">
      {children}
    </span>
  );
}

export default function MobileDock({
  toolVisibility,
  generatingHrefs,
}: {
  toolVisibility: Record<string, ToolSidebarVisibility> | null;
  generatingHrefs: Set<string>;
}) {
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  const homeActive = pathname === "/dashboard";
  const libraryActive = pathname === "/dashboard/assets" || pathname.startsWith("/dashboard/assets/");
  const calendarActive =
    pathname === "/tools/scheduler/calendar" || pathname.startsWith("/tools/scheduler/calendar/");
  const createActive = TOOL_MENU.some((tool) =>
    isToolActive(pathname, tool.href, tool.exact)
  );

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!popRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const comingSoon = (toolKey: string) => Boolean(toolVisibility?.[toolKey]?.coming_soon);
  const createGenerating = TOOL_MENU.some((tool) => generatingHrefs.has(tool.href));

  return (
    <>
      {open ? (
        <button
          type="button"
          aria-label="Close tools"
          className="fixed inset-0 z-[59] bg-black/50 backdrop-blur-md md:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <nav
        ref={popRef}
        aria-label="Primary"
        className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-2 md:hidden"
      >
        {open ? (
          <div className="absolute bottom-[calc(100%+12px)] left-1/2 w-[min(22.5rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-2xl border border-white/10 bg-N50 p-3 shadow-2xl shadow-black/50">
            <div className="grid grid-cols-3 gap-2">
              {TOOL_MENU.map((tool) => {
                const Icon = tool.icon;
                const soon = comingSoon(tool.toolKey);
                const active = isToolActive(pathname, tool.href, tool.exact);
                const generating = generatingHrefs.has(tool.href);
                return (
                  <Link
                    key={tool.href}
                    href={tool.href}
                    onClick={() => setOpen(false)}
                    className={`relative flex flex-col items-center gap-2.5 rounded-xl px-2 py-4 text-center transition-colors ${
                      soon ? "opacity-50" : ""
                    } ${
                      active ? "bg-white/10 text-N900" : "text-text-primary hover:bg-white/[0.08]"
                    }`}
                  >
                    <span className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
                      <Icon className="h-6 w-6" />
                      {generating ? (
                        <span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-brand-primary animate-pulse" />
                      ) : null}
                    </span>
                    <span className="text-xs font-medium">
                      {tool.label}
                      {soon ? (
                        <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-wide text-warning">
                          Soon
                        </span>
                      ) : null}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="flex items-center gap-3 rounded-full border border-white/15 bg-N0/60 px-2.5 py-1.5 shadow-lg shadow-black/40 backdrop-blur-xl backdrop-saturate-150">
          <Link
            href="/dashboard"
            aria-label="Home"
            className={
              homeActive
                ? "flex h-11 items-center gap-2 rounded-full bg-white pl-1.5 pr-3.5 text-N50 shadow-sm"
                : "rounded-full"
            }
          >
            {homeActive ? (
              <>
                <Image
                  src="/Logo White.png"
                  alt=""
                  width={28}
                  height={28}
                  className="h-7 w-7 shrink-0 object-contain"
                />
                <span className="text-sm font-semibold">Home</span>
              </>
            ) : (
              <DockCircle>
                <Image
                  src="/Logo White transparent.png"
                  alt=""
                  width={18}
                  height={18}
                  className="h-5 w-5 object-contain"
                />
              </DockCircle>
            )}
          </Link>

          <Link
            href="/dashboard/assets"
            aria-label="Library"
            title="Library"
            className={
              libraryActive
                ? "flex h-11 items-center gap-2 rounded-full bg-white px-3.5 text-N50 shadow-sm"
                : "rounded-full"
            }
          >
            {libraryActive ? (
              <>
                <Images className="h-[18px] w-[18px] text-N50" />
                <span className="text-sm font-semibold">Library</span>
              </>
            ) : (
              <DockCircle>
                <Images className="h-5 w-5" />
              </DockCircle>
            )}
          </Link>

          <Link
            href="/tools/scheduler/calendar"
            aria-label="Calendar"
            title="Calendar"
            className={`${comingSoon("calendar") ? "opacity-50" : ""} ${
              calendarActive
                ? "flex h-11 items-center gap-2 rounded-full bg-white px-3.5 text-N50 shadow-sm"
                : "rounded-full"
            }`}
          >
            {calendarActive ? (
              <>
                <CalendarDays className="h-[18px] w-[18px] text-N50" />
                <span className="text-sm font-semibold">Calendar</span>
              </>
            ) : (
              <DockCircle>
                <CalendarDays className="h-5 w-5" />
              </DockCircle>
            )}
          </Link>
        </div>

        <button
          type="button"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-label={open ? "Close tools" : "Open tools"}
          onClick={() => setOpen((value) => !value)}
          className={`relative flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-N0/60 shadow-lg shadow-black/40 backdrop-blur-xl backdrop-saturate-150 ${
            createActive && !open ? "ring-2 ring-white/25" : ""
          }`}
        >
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-N50">
            {open ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
          </span>
          {createGenerating ? (
            <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand-primary animate-pulse" />
          ) : null}
        </button>
      </nav>
    </>
  );
}
