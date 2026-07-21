"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useCurrentUser } from "@/lib/auth-context";
import { getSupabaseAuthBrowser } from "@/lib/supabase-browser-auth";
import {
  Video,
  Camera,
  Aperture,
  CalendarClock,
  CalendarDays,
  LayoutDashboard,
  Images,
  Settings,
  Shield,
  LogOut,
} from "lucide-react";
import CreditBadge from "@/components/CreditBadge";

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
  // Maps to tool_configs.tool_key. When set, the item is hidden if the tool is
  // disabled or not visible_in_sidebar. Items without a toolKey always show.
  toolKey?: string;
}

const SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: "Overview",
    items: [
      { label: "Dashboard", href: "/dashboard", icon: <LayoutDashboard className="h-4 w-4" />, toolKey: "dashboard" },
    ],
  },
  {
    title: "Create",
    items: [
      { label: "Video", href: "/tools/video", icon: <Video className="h-4 w-4" />, toolKey: "reels" },
      { label: "Photo", href: "/tools/photo-v2", icon: <Camera className="h-4 w-4" />, toolKey: "photo" },
      { label: "Instagram", href: "/tools/ig", icon: <Aperture className="h-4 w-4" />, toolKey: "ig" },
    ],
  },
  {
    title: "Library",
    items: [
      { label: "My Library", href: "/dashboard/assets", icon: <Images className="h-4 w-4" /> },
    ],
  },
  {
    title: "Publish",
    items: [
      { label: "Schedule", href: "/tools/scheduler", icon: <CalendarClock className="h-4 w-4" />, toolKey: "schedule" },
      { label: "Calendar", href: "/tools/scheduler/calendar", icon: <CalendarDays className="h-4 w-4" />, toolKey: "calendar" },
    ],
  },
  {
    title: "Account",
    items: [
      { label: "Settings", href: "/dashboard/settings", icon: <Settings className="h-4 w-4" /> },
    ],
  },
];

type ToolVisibility = {
  tool_key: string;
  enabled: boolean;
  visible_in_sidebar: boolean;
};

export default function Sidebar() {
  const pathname = usePathname();
  const { status, name, email, image } = useCurrentUser();
  const [isAdmin, setIsAdmin] = useState(false);
  const [toolVisibility, setToolVisibility] = useState<Record<string, ToolVisibility> | null>(
    null
  );

  // Admin link visibility (cosmetic only — the real gate is the server-side
  // requireAdmin() guard on /admin pages and APIs).
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/admin/me")
      .then((res) => (res.ok ? res.json() : { isAdmin: false }))
      .then((d: { isAdmin?: boolean }) => setIsAdmin(Boolean(d.isAdmin)))
      .catch(() => setIsAdmin(false));
  }, [status]);

  // Tool visibility from tool_configs. Fails open: if the fetch fails the
  // sidebar shows everything (never hides a tool due to a transient error).
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/tools/config")
      .then((res) => (res.ok ? res.json() : { tools: [] }))
      .then((d: { tools?: ToolVisibility[] }) => {
        const map: Record<string, ToolVisibility> = {};
        for (const t of d.tools ?? []) map[t.tool_key] = t;
        setToolVisibility(map);
      })
      .catch(() => setToolVisibility(null));
  }, [status]);

  // An item shows unless its tool config explicitly hides/disables it. Items
  // without a toolKey (e.g. Settings) always show.
  const isItemVisible = (item: NavItem): boolean => {
    if (!item.toolKey || !toolVisibility) return true;
    const cfg = toolVisibility[item.toolKey];
    if (!cfg) return true;
    return cfg.enabled && cfg.visible_in_sidebar;
  };

  const visibleSections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter(isItemVisible),
  })).filter((section) => section.items.length > 0);

  const sectionsToRender = isAdmin
    ? [
        ...visibleSections,
        {
          title: "Admin",
          items: [
            { label: "Admin Panel", href: "/admin", icon: <Shield className="h-4 w-4" /> },
          ],
        },
      ]
    : visibleSections;

  const isActive = (href: string) => {
    // Routes whose subpaths are owned by another menu item must match exactly,
    // otherwise multiple items would highlight at the same time
    // (e.g. /tools/scheduler/calendar would also highlight "Schedule").
    const exactOnly = href === "/dashboard" || href === "/tools/scheduler";
    if (exactOnly) return pathname === href;
    return pathname === href || pathname?.startsWith(`${href}/`);
  };

  const mobileNavItems = sectionsToRender.flatMap((section) => section.items);

  // Light feedback while the mobile nav is scrolled: a haptic vibration
  // (Android/Chrome only — iOS Safari lacks the Vibration API) plus a synthesized
  // "tick" sound so it still feels tactile on devices without vibration.
  // Throttled so it reads as a subtle texture rather than a constant buzz.
  const lastHapticRef = useRef(0);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const playTick = () => {
    try {
      const AC =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AC) return;
      if (!audioCtxRef.current) audioCtxRef.current = new AC();
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") void ctx.resume();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = 180;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.04, now + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.05);
    } catch {
      /* audio unavailable — ignore */
    }
  };

  const handleHapticScroll = () => {
    const now = Date.now();
    if (now - lastHapticRef.current < 90) return;
    lastHapticRef.current = now;
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(3);
    }
    playTick();
  };

  // Dashboard uses the Kelolako logo instead of a lucide icon. Pick the logo
  // variant that reads on the current background (black on light, white on dark).
  const renderNavIcon = (
    item: NavItem,
    opts: { onLight: boolean; sizeClass: string }
  ) =>
    item.href === "/dashboard" ? (
      <Image
        src={opts.onLight ? "/Logo White.png" : "/Logo White transparent.png"}
        alt=""
        width={32}
        height={32}
        className={`${opts.sizeClass} shrink-0 object-contain`}
      />
    ) : (
      item.icon
    );

  return (
    <>
      <aside
        className="hidden h-screen w-60 shrink-0 flex-col border-r border-gray-800 bg-gray-950 md:sticky md:top-0 md:flex"
      >
      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-gray-800 px-5 py-5">
        <Image
          src="/Logo White transparent.svg"
          alt="Kelolako"
          width={28}
          height={28}
          className="h-7 w-7 shrink-0 object-contain"
        />
        <span className="text-base font-black uppercase tracking-[-0.5px] text-white">
          KELOLAKO
        </span>
      </div>

      {/* Nav sections */}
      <nav className="flex-1 overflow-y-auto px-3 py-5">
        {sectionsToRender.map((section) => (
          <div key={section.title} className="mb-6">
            <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-gray-500">
              {section.title}
            </p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                        active
                          ? "bg-violet-500/15 text-violet-300"
                          : "text-gray-400 hover:bg-gray-800 hover:text-white"
                      }`}
                    >
                      <span className={active ? "text-violet-400" : "text-gray-500"}>
                        {item.icon}
                      </span>
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User profile */}
      <div className="hidden border-t border-gray-800 p-3 md:block">
        {status === "authenticated" ? (
          <div className="relative rounded-xl border border-white/10 bg-white/[0.03] p-3 transition-colors hover:border-white/20 hover:bg-white/[0.05]">
            <button
              type="button"
              onClick={() => getSupabaseAuthBrowser().auth.signOut().then(() => { window.location.href = "/"; })}
              aria-label="Sign out"
              className="absolute right-2 top-2 cursor-pointer rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
            <Link
              href="/dashboard/settings"
              aria-label="Open profile settings"
              className="flex min-w-0 flex-col items-start gap-2 text-left"
            >
              {image ? (
                <Image
                  src={image}
                  alt={name ?? "Profile"}
                  width={40}
                  height={40}
                  className="h-10 w-10 shrink-0 rounded-full ring-2 ring-white/10"
                />
              ) : (
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-violet-500/40 to-indigo-500/20 text-sm font-semibold text-violet-100 ring-2 ring-white/10">
                  {name?.[0]?.toUpperCase() ?? "?"}
                </div>
              )}
              <div className="min-w-0 w-full">
                <p className="truncate text-sm font-semibold text-white">{name}</p>
                <p className="truncate text-[10px] text-gray-500">{email}</p>
              </div>
              <CreditBadge />
            </Link>
          </div>
        ) : (
          <div className="h-32 animate-pulse rounded-xl bg-white/[0.03]" />
        )}
      </div>
      </aside>

      {/* Mobile floating navigation — individual circular buttons */}
      {mobileNavItems.length > 0 && (
        <nav
          aria-label="Primary"
          className="fixed bottom-4 left-1/2 z-[60] max-w-[calc(100vw-1rem)] -translate-x-1/2 md:hidden"
        >
          <div
            onScroll={handleHapticScroll}
            className="flex items-center gap-2.5 overflow-x-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {mobileNavItems.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  title={item.label}
                  className={`flex h-14 shrink-0 items-center justify-center gap-2 rounded-full shadow-lg shadow-black/30 transition-colors [&_svg]:h-6 [&_svg]:w-6 ${
                    active
                      ? "bg-white px-5 text-gray-900"
                      : "w-14 border border-white/20 bg-white/10 text-gray-200 ring-1 ring-inset ring-white/10 backdrop-blur-xl backdrop-saturate-150 hover:bg-white/20 hover:text-white"
                  }`}
                >
                  {renderNavIcon(item, { onLight: active, sizeClass: active ? "h-8 w-8" : "h-6 w-6" })}
                  {active && (
                    <span className="whitespace-nowrap text-sm font-semibold">
                      {item.label}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}
