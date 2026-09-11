"use client";

import Link from "next/link";
import { ImageIcon, Sparkles, Video } from "lucide-react";

export type StudioModeId = "agent" | "image" | "video";

const MODES: {
  id: StudioModeId;
  label: string;
  href: string;
  icon: typeof Sparkles;
}[] = [
  { id: "agent", label: "Skills", href: "/dashboard", icon: Sparkles },
  { id: "image", label: "Image", href: "/tools/photo-v2", icon: ImageIcon },
  { id: "video", label: "Video", href: "/tools/video", icon: Video },
];

export function StudioModeRail({
  active,
  className = "",
}: {
  active: StudioModeId;
  className?: string;
}) {
  return (
    <nav
      aria-label="Studio mode"
      className={`flex w-full shrink-0 flex-row gap-0.5 rounded-radius-xl border border-white/10 bg-white/[0.04] p-1 lg:w-auto lg:flex-col lg:self-start ${className}`}
    >
      {MODES.map((mode) => {
        const Icon = mode.icon;
        const selected = mode.id === active;
        return (
          <Link
            key={mode.id}
            href={mode.href}
            aria-current={selected ? "page" : undefined}
            className={`flex min-w-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-radius-md px-2 py-1.5 text-[10px] font-semibold tracking-wide transition-colors lg:flex-none ${
              selected
                ? "bg-white/10 text-text-primary"
                : "text-text-secondary hover:bg-white/5 hover:text-text-primary"
            }`}
          >
            <Icon className="h-4 w-4" />
            {mode.label}
          </Link>
        );
      })}
    </nav>
  );
}
