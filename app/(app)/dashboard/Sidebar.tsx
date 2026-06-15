"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  Mountain,
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
      { label: "Reels", href: "/tools/reels", icon: <Video className="h-4 w-4" />, toolKey: "reels" },
      { label: "Photo", href: "/tools/photo-v2", icon: <Camera className="h-4 w-4" />, toolKey: "photo" },
      { label: "Photo backup", href: "/tools/photo", icon: <Camera className="h-4 w-4" />, toolKey: "photo" },
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
  const { data: session, status } = useSession();
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

  return (
    <aside className="flex h-screen w-60 shrink-0 flex-col border-r border-gray-800 bg-gray-950 sticky top-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 border-b border-gray-800 px-5 py-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-600">
          <Mountain className="h-4 w-4 text-white" />
        </div>
        <span className="text-base font-black tracking-tight text-white">Krakatoa</span>
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
      <div className="border-t border-gray-800 p-3">
        {session?.user ? (
          <div className="flex items-center gap-1 rounded-lg bg-gray-900 px-1 py-1">
            <Link
              href="/dashboard/settings"
              aria-label="Open profile settings"
              className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-1.5 py-1 transition-colors hover:bg-gray-800"
            >
              {session.user.image ? (
                <Image
                  src={session.user.image}
                  alt={session.user.name ?? "Profile"}
                  width={32}
                  height={32}
                  className="h-8 w-8 shrink-0 rounded-full"
                />
              ) : (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-500/20 text-xs font-semibold text-violet-300">
                  {session.user.name?.[0]?.toUpperCase() ?? "?"}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-white">{session.user.name}</p>
                <p className="truncate text-[10px] text-gray-500">{session.user.email}</p>
                <div className="mt-1">
                  <CreditBadge />
                </div>
              </div>
            </Link>
            <button
              type="button"
              onClick={() => signOut({ callbackUrl: "/" })}
              aria-label="Sign out"
              className="shrink-0 cursor-pointer self-start rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-white"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : (
          <div className="h-12 animate-pulse rounded-lg bg-gray-900" />
        )}
      </div>
    </aside>
  );
}
