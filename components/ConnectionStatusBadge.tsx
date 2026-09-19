"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Music2 } from "lucide-react";
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

// ─── InstagramIcon ───────────────────────────────────────────────────────────
// Same reason as YoutubeIcon above — no brand icons in this lucide-react
// version. Replaces the generic Camera stand-in previously used here and on
// the Create & Schedule platform checkbox (a camera doesn't read as
// "Instagram" to users at a glance). This is the classic rounded-square +
// lens-circle + flash-dot glyph — a generic geometric mark, not Instagram's
// actual wordmark/gradient logo.
export function InstagramIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
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

// TikTok uses a generic stand-in icon for the same reason YoutubeIcon above
// is a custom SVG — lucide-react doesn't ship brand logos.
const CONNECTION_BADGE_CONFIG: Record<
  ConnectionPlatform,
  { label: string; icon: React.ComponentType<{ className?: string }> }
> = {
  youtube: { label: "YouTube", icon: YoutubeIcon },
  tiktok: { label: "TikTok", icon: Music2 },
  instagram: { label: "Instagram", icon: InstagramIcon },
};

type ConnectionState = { connected: boolean; username: string | null };

export function ConnectionStatusBadge({ platform }: { platform: ConnectionPlatform }) {
  const { status } = useCurrentUser();
  const [state, setState] = useState<ConnectionState | null>(null);
  const { label, icon: Icon } = CONNECTION_BADGE_CONFIG[platform];

  useEffect(() => {
    if (status === "loading") return;
    if (status === "unauthenticated") { setState({ connected: false, username: null }); return; }
    fetch("/api/connections/status")
      .then((res) => (res.ok ? res.json() : {}))
      .then(
        (data: Partial<Record<ConnectionPlatform, boolean>> & {
          usernames?: Partial<Record<ConnectionPlatform, string | null>>;
        }) =>
          setState({
            connected: Boolean(data[platform]),
            username: data.usernames?.[platform] ?? null,
          }),
      )
      .catch(() => setState({ connected: false, username: null }));
  }, [status, platform]);

  if (status === "loading" || state === null) {
    return <div className="h-9 w-44 animate-pulse rounded-lg bg-white/10" />;
  }
  if (state.connected) {
    // Clickable too (not just the disconnected state below) — lets someone
    // reconnect a different account without hunting for Settings first; see
    // the "switch account" half of this component's reason for existing.
    return (
      <Link
        href="/dashboard/settings?tab=connections"
        className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-3 py-1.5 transition-colors hover:border-success/50 hover:bg-success/15"
      >
        <Icon className="h-3.5 w-3.5 text-success" />
        <span className="text-xs font-medium text-success">
          {label} Connected
          {/* Best-effort (see each OAuth callback route) — omitted rather
              than shown as a placeholder when it never got fetched. */}
          {state.username ? <span className="text-success/70"> · {state.username}</span> : null}
        </span>
      </Link>
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
      className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 transition-colors hover:border-white/20 hover:bg-white/10"
    >
      <Icon className="h-3.5 w-3.5 text-text-secondary" />
      <span className="text-xs font-medium text-text-secondary">Connect {label}</span>
    </Link>
  );
}
