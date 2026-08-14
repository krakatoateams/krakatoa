"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Music2, Camera } from "lucide-react";
import { useCurrentUser } from "@/lib/auth-context";

// ─── YoutubeIcon ─────────────────────────────────────────────────────────────
// lucide-react doesn't ship brand/logo icons (trademark reasons), hence this
// hand-rolled SVG rather than an import.

export function YoutubeIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

// ─── Connection status badge ───────────────────────────────────────────────
// One badge per platform /api/connections/status knows about. Each instance
// fetches independently and is parameterized by `platform` — this used to be
// a YouTube-only component (YouTubeStatusBadge, calendar page only) that
// never got extended when TikTok/Instagram connect flows landed later, even
// though the status route itself already returned all three. Shared here so
// the Calendar and Scheduler pages (and anywhere else, later) render one
// source of truth instead of duplicating it per page.

export type ConnectionPlatform = "youtube" | "tiktok" | "instagram";

// TikTok and Instagram use generic stand-in icons for the same reason
// YoutubeIcon above is a custom SVG — lucide-react doesn't ship brand logos.
const CONNECTION_BADGE_CONFIG: Record<
  ConnectionPlatform,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  youtube: { label: "YouTube", icon: YoutubeIcon },
  tiktok: { label: "TikTok", icon: Music2 },
  instagram: { label: "Instagram", icon: Camera },
};

export function ConnectionStatusBadge({ platform }: { platform: ConnectionPlatform }) {
  const { status } = useCurrentUser();
  const [connected, setConnected] = useState<boolean | null>(null);
  const { label, icon: Icon } = CONNECTION_BADGE_CONFIG[platform];

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") { setConnected(false); return; }
    fetch("/api/connections/status")
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: Partial<Record<ConnectionPlatform, boolean>>) => setConnected(Boolean(data[platform])))
      .catch(() => setConnected(false));
  }, [status, platform]);

  if (status === "loading" || connected === null) {
    return <div className="h-9 w-44 animate-pulse rounded-lg bg-gray-800" />;
  }
  if (connected) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-1.5">
        <Icon className="h-3.5 w-3.5 text-green-400" />
        <span className="text-xs font-medium text-green-400">{label} Connected</span>
      </div>
    );
  }
  // Not connected — same pill, but doubles as the CTA: no extra banner/alert
  // element, just made clickable with a shorter, action-first label and a
  // hover state to signal it. Deliberately stays neutral gray rather than
  // switching to an alarm color, so a row of several disconnected platforms
  // doesn't read as a wall of warnings.
  return (
    <Link
      href="/dashboard/settings?tab=connections"
      className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 transition-colors hover:border-gray-600 hover:bg-gray-700"
    >
      <Icon className="h-3.5 w-3.5 text-gray-500" />
      <span className="text-xs font-medium text-gray-500">Connect {label}</span>
    </Link>
  );
}
