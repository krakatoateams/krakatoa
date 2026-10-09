"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { AlertCircle, Bell, CheckCircle2, ExternalLink, UserPlus, X } from "lucide-react";
import { useNotifications } from "@/app/(app)/notifications-context";
import type { NotificationTone, NotificationView } from "@/lib/notifications-pure";

type Variant = "sidebar" | "mobile";

type PanelState =
  | { phase: "loading" }
  | { phase: "error" }
  | { phase: "ready"; items: NotificationView[] };

const TONE_ICON: Record<NotificationTone, { icon: typeof Bell; className: string }> = {
  success: { icon: CheckCircle2, className: "bg-success/10 text-success" },
  error: { icon: AlertCircle, className: "bg-error/10 text-error" },
  info: { icon: UserPlus, className: "bg-info/10 text-info" },
};

function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "Just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Shape-matched placeholder for one notification row. */
function RowSkeleton() {
  return (
    <div className="flex gap-3 px-3 py-3" aria-hidden>
      <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-white/10" />
      <div className="min-w-0 flex-1 space-y-2 pt-0.5">
        <div className="h-3 w-3/5 animate-pulse rounded bg-white/10" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-white/[0.06]" />
        <div className="h-2.5 w-12 animate-pulse rounded bg-white/[0.06]" />
      </div>
    </div>
  );
}

function NotificationRow({
  item,
  now,
  onNavigate,
}: {
  item: NotificationView;
  now: number;
  onNavigate: () => void;
}) {
  const { icon: Icon, className } = TONE_ICON[item.tone];
  return (
    <li className={`relative rounded-xl transition-colors ${item.unread ? "bg-white/[0.04]" : ""}`}>
      <Link
        href={item.href}
        onClick={onNavigate}
        className="flex gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-white/[0.06]"
      >
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${className}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text-primary">{item.title}</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-text-secondary">{item.body}</span>
          <span className="mt-1 block text-[11px] text-text-secondary/80">{timeAgo(item.createdAt, now)}</span>
        </span>
        {item.unread ? (
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand-primary" aria-label="Unread" />
        ) : null}
      </Link>
      {item.externalHref ? (
        <a
          href={item.externalHref}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-2 ml-14 inline-flex items-center gap-1 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          View post
          <ExternalLink className="h-3 w-3" />
        </a>
      ) : null}
    </li>
  );
}

/**
 * Bell + unread badge + panel. Opening the panel loads the newest
 * Notifications, then marks them all read — rows that were unread keep their
 * highlight until the panel closes. Desktop: a popover beside the sidebar.
 * Mobile: a bottom sheet.
 */
export function NotificationBell({ variant }: { variant: Variant }) {
  const { unreadCount, clearUnread, refreshCount } = useNotifications();
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<PanelState>({ phase: "loading" });
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    setPanel({ phase: "loading" });
    setNow(Date.now());
    fetch("/api/notifications", { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`notifications ${res.status}`);
        return res.json() as Promise<{ items: NotificationView[] }>;
      })
      .then(({ items }) => {
        setPanel({ phase: "ready", items });
        if (items.some((item) => item.unread)) {
          clearUnread();
          // Items are newest-first: mark read only through what was shown.
          fetch("/api/notifications/read", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ newestShownAt: items[0].createdAt }),
          })
            .catch(() => {})
            .finally(refreshCount);
        }
      })
      .catch(() => setPanel({ phase: "error" }));
  }, [clearUnread, refreshCount]);

  const toggle = () => {
    if (!open) load();
    setOpen(!open);
  };

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const badge = unreadCount > 9 ? "9+" : String(unreadCount);
  const label = unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications";

  const panelBody = (
    <>
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <h2 className="text-sm font-semibold text-text-primary">Notifications</h2>
        <button
          type="button"
          onClick={close}
          aria-label="Close notifications"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {panel.phase === "loading" ? (
          <div>
            <RowSkeleton />
            <RowSkeleton />
            <RowSkeleton />
          </div>
        ) : panel.phase === "error" ? (
          <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
            <p className="text-sm text-text-secondary">Couldn&apos;t load notifications.</p>
            <button
              type="button"
              onClick={load}
              className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-text-primary transition-colors hover:bg-white/10"
            >
              Try again
            </button>
          </div>
        ) : panel.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[0.06]">
              <Bell className="h-5 w-5 text-icon-low-emphasis" />
            </span>
            <p className="text-sm font-medium text-text-primary">You&apos;re all caught up</p>
            <p className="text-xs text-text-secondary">
              Finished generations, published posts and canvas invites show up here.
            </p>
          </div>
        ) : (
          <ul className="space-y-0.5">
            {panel.items.map((item) => (
              <NotificationRow key={item.id} item={item} now={now} onNavigate={close} />
            ))}
          </ul>
        )}
      </div>
    </>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`relative flex h-8 w-8 items-center justify-center rounded-full text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-text-primary ${
          open ? "bg-white/10 text-text-primary" : ""
        }`}
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-primary px-1 text-[10px] font-bold leading-none text-white ring-2 ring-N50">
            {badge}
          </span>
        ) : null}
      </button>

      {/* Portaled: the mobile header's backdrop-blur would otherwise become
          the containing block for these fixed-position panels. */}
      {open
        ? createPortal(
            variant === "sidebar" ? (
              <div
                ref={panelRef}
                role="dialog"
                aria-label="Notifications"
                className="fixed left-64 top-2 z-[70] flex max-h-[min(36rem,calc(100vh-1rem))] w-[22rem] flex-col overflow-hidden rounded-2xl border border-white/10 bg-N50 shadow-2xl shadow-black/50"
              >
                {panelBody}
              </div>
            ) : (
              <div ref={panelRef} className="fixed inset-0 z-[80]">
                <div className="absolute inset-0 bg-black/60" aria-hidden onClick={close} />
                <div
                  role="dialog"
                  aria-label="Notifications"
                  className="absolute inset-x-0 bottom-0 flex max-h-[80dvh] flex-col overflow-hidden rounded-t-2xl border-t border-white/10 bg-N50 pb-[env(safe-area-inset-bottom)] shadow-2xl shadow-black/50"
                >
                  <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/20" aria-hidden />
                  {panelBody}
                </div>
              </div>
            ),
            document.body,
          )
        : null}
    </div>
  );
}
