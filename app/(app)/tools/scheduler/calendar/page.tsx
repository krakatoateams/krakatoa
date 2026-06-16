"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession, signIn } from "next-auth/react";
import {
  ChevronLeft,
  ChevronRight,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  Tag,
  ExternalLink,
  RefreshCw,
} from "lucide-react";
import { derivePostDisplayStatus } from "@/lib/post-status";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Post {
  id: string;
  user_id: string;
  platform: string;
  video_url: string;
  youtube_video_id?: string | null;
  title: string;
  description: string;
  tags: string;
  scheduled_time: string;
  status: "draft" | "scheduled" | "published" | "failed";
  last_error?: string | null;
  publish_started_at?: string | null;
  created_at: string;
}

interface ToastState {
  type: "success" | "error";
  message: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const STATUS_CFG = {
  scheduled: {
    label: "Scheduled",
    dot: "bg-blue-400",
    badge: "border-blue-500/30 bg-blue-500/10 text-blue-400",
    chip: "border-blue-500/40 bg-blue-500/10 text-blue-300 hover:bg-blue-500/20",
    stat: "text-blue-400",
  },
  overdue: {
    label: "Overdue",
    dot: "bg-amber-400",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-400",
    chip: "border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20",
    stat: "text-amber-400",
  },
  publishing: {
    label: "Publishing",
    dot: "bg-violet-400",
    badge: "border-violet-500/30 bg-violet-500/10 text-violet-300",
    chip: "border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20",
    stat: "text-violet-300",
  },
  published: {
    label: "Published",
    dot: "bg-green-400",
    badge: "border-green-500/30 bg-green-500/10 text-green-400",
    chip: "border-green-500/40 bg-green-500/10 text-green-300 hover:bg-green-500/20",
    stat: "text-green-400",
  },
  failed: {
    label: "Failed",
    dot: "bg-red-400",
    badge: "border-red-500/30 bg-red-500/10 text-red-400",
    chip: "border-red-500/40 bg-red-500/10 text-red-300 hover:bg-red-500/20",
    stat: "text-red-400",
  },
  draft: {
    label: "Draft",
    dot: "bg-gray-500",
    badge: "border-gray-700 bg-gray-800 text-gray-400",
    chip: "border-gray-700 bg-gray-800 text-gray-400 hover:bg-gray-700",
    stat: "text-gray-400",
  },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildCalendarDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startPad = firstDay.getDay();

  const days: { date: Date; isCurrentMonth: boolean }[] = [];

  for (let i = startPad - 1; i >= 0; i--) {
    const d = new Date(year, month, 0);
    d.setDate(d.getDate() - i);
    days.push({ date: d, isCurrentMonth: false });
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push({ date: new Date(year, month, d), isCurrentMonth: true });
  }
  let nextD = 1;
  while (days.length < 42) {
    days.push({ date: new Date(year, month + 1, nextD++), isCurrentMonth: false });
  }
  return days;
}

function toLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function postDateKey(isoString: string): string {
  return toLocalDateKey(new Date(isoString));
}

function fmtTime(isoString: string) {
  return new Date(isoString).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDateTime(isoString: string) {
  return new Date(isoString).toLocaleString([], {
    weekday: "short", month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── YoutubeIcon ─────────────────────────────────────────────────────────────

function YoutubeIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

// ─── Toast ────────────────────────────────────────────────────────────────────

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4500);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const ok = toast.type === "success";
  return (
    <div
      role="alert"
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border px-4 py-3 shadow-xl ${
        ok ? "border-green-500/30 bg-green-500/10 text-green-400"
           : "border-red-500/30 bg-red-500/10 text-red-400"
      }`}
    >
      {ok ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      <span className="text-sm font-medium">{toast.message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss" className="cursor-pointer opacity-60 hover:opacity-100">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── YouTube status badge ─────────────────────────────────────────────────────

function YouTubeStatusBadge() {
  const { status } = useSession();
  if (status === "loading") {
    return <div className="h-9 w-44 animate-pulse rounded-lg bg-gray-800" />;
  }
  if (status === "authenticated") {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-1.5">
        <YoutubeIcon className="h-3.5 w-3.5 text-green-400" />
        <span className="text-xs font-medium text-green-400">YouTube Connected</span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => signIn("google", { callbackUrl: "/tools/scheduler" })}
      className="flex cursor-pointer items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-400 transition-colors hover:border-red-500/60 hover:bg-red-500/20"
      aria-label="Connect YouTube account"
    >
      <YoutubeIcon className="h-3.5 w-3.5" />
      Connect YouTube
    </button>
  );
}

// ─── Post Detail Modal ────────────────────────────────────────────────────────

function PostModal({ post, onClose }: { post: Post; onClose: () => void }) {
  const cfg = STATUS_CFG[derivePostDisplayStatus(post)] ?? STATUS_CFG.draft;
  const tags = post.tags ? post.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Post details"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md rounded-2xl border border-gray-800 bg-gray-900 shadow-2xl">
        <div className="flex items-start justify-between border-b border-gray-800 p-5">
          <div className="flex items-center gap-2.5">
            <YoutubeIcon className="h-5 w-5 text-red-400" />
            <span className="text-xs font-medium uppercase tracking-wider text-gray-500">YouTube</span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.badge}`}>
              <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
            <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-md p-1 text-gray-600 transition-colors hover:bg-gray-800 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="space-y-4 p-5">
          <h3 className="text-base font-semibold leading-snug text-white">{post.title}</h3>

          <div className="flex items-center gap-1.5 text-sm text-gray-400">
            <Clock className="h-3.5 w-3.5 text-gray-600" />
            {fmtDateTime(post.scheduled_time)}
          </div>

          {post.status === "failed" && post.last_error && (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="leading-relaxed">{post.last_error}</span>
            </div>
          )}

          {post.description && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wider text-gray-600">Description</p>
              <p className="text-sm leading-relaxed text-gray-300">{post.description}</p>
            </div>
          )}

          {tags.length > 0 && (
            <div>
              <div className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-gray-600">
                <Tag className="h-3 w-3" /> Tags
              </div>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-gray-700 bg-gray-800 px-2.5 py-0.5 text-xs text-gray-400">
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-2 border-t border-gray-800 p-5">
          {post.status === "published" && post.youtube_video_id && (
            <a
              href={`https://www.youtube.com/watch?v=${post.youtube_video_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-500"
            >
              <YoutubeIcon className="h-4 w-4" />
              View on YouTube
            </a>
          )}
          <a
            href={post.video_url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
          >
            <ExternalLink className="h-4 w-4" />
            View source video
          </a>
        </div>
      </div>
    </div>
  );
}

// ─── Post Chip ────────────────────────────────────────────────────────────────

interface PostChipProps {
  post: Post;
  onClick: () => void;
  onDragStart: () => void;
  isDragging: boolean;
}

function PostChip({ post, onClick, onDragStart, isDragging }: PostChipProps) {
  const cfg = STATUS_CFG[derivePostDisplayStatus(post)] ?? STATUS_CFG.draft;

  return (
    <button
      type="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("postId", post.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={post.title}
      className={`group flex w-full cursor-grab items-center gap-1.5 truncate rounded border px-1.5 py-0.5 text-left text-[11px] font-medium transition-all active:cursor-grabbing ${cfg.chip} ${
        isDragging ? "opacity-40 ring-1 ring-violet-500" : ""
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${cfg.dot}`} />
      <span className="truncate">{post.title}</span>
      <span className="ml-auto shrink-0 text-[10px] opacity-60">{fmtTime(post.scheduled_time)}</span>
    </button>
  );
}

// ─── Day Cell ─────────────────────────────────────────────────────────────────

interface DayCellProps {
  date: Date;
  isCurrentMonth: boolean;
  isToday: boolean;
  posts: Post[];
  draggingId: string | null;
  dragOverKey: string | null;
  onPostClick: (post: Post) => void;
  onDragStart: (postId: string) => void;
  onDragOver: (dateKey: string) => void;
  onDragLeave: () => void;
  onDrop: (dateKey: string) => void;
}

function DayCell({
  date,
  isCurrentMonth,
  isToday,
  posts,
  draggingId,
  dragOverKey,
  onPostClick,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
}: DayCellProps) {
  const dateKey = toLocalDateKey(date);
  const isOver = dragOverKey === dateKey && draggingId !== null;
  const MAX_VISIBLE = 3;
  const visible = posts.slice(0, MAX_VISIBLE);
  const overflow = posts.length - MAX_VISIBLE;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(dateKey); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop(dateKey); }}
      className={`group relative flex min-h-[120px] flex-col gap-1 rounded-lg border p-2 transition-all duration-150 ${
        !isCurrentMonth ? "border-gray-800/50 bg-gray-900/30" :
        isOver ? "border-violet-500/60 bg-violet-500/10 ring-1 ring-violet-500/40" :
        isToday ? "border-violet-500/30 bg-violet-500/5" :
        "border-gray-800 bg-gray-900 hover:border-gray-700"
      }`}
    >
      <div className="flex items-center justify-between">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
            isToday ? "bg-violet-500 text-white" :
            isCurrentMonth ? "text-gray-300" :
            "text-gray-700"
          }`}
        >
          {date.getDate()}
        </span>
        {isOver && (
          <span className="rounded text-[10px] font-medium text-violet-400">Drop here</span>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        {visible.map((post) => (
          <PostChip
            key={post.id}
            post={post}
            onClick={() => onPostClick(post)}
            onDragStart={() => onDragStart(post.id)}
            isDragging={draggingId === post.id}
          />
        ))}
        {overflow > 0 && (
          <span className="pl-1 text-[10px] text-gray-600">+{overflow} more</span>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulerCalendarPage() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [selectedPost, setSelectedPost] = useState<Post | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPosts = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/posts");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load posts.");
      setPosts(data.posts as Post[]);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load posts.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchPosts(); }, [fetchPosts]);

  const prevMonth = () => {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
  };
  const goToToday = () => { setYear(now.getFullYear()); setMonth(now.getMonth()); };

  const handleDrop = useCallback(async (targetDateKey: string) => {
    const postId = draggingId;
    setDraggingId(null);
    setDragOverKey(null);
    if (!postId) return;

    const post = posts.find((p) => p.id === postId);
    if (!post) return;

    if (postDateKey(post.scheduled_time) === targetDateKey) return;

    const original = new Date(post.scheduled_time);
    const [ty, tm, td] = targetDateKey.split("-").map(Number);
    const newDt = new Date(ty, tm - 1, td, original.getHours(), original.getMinutes(), 0, 0);

    setPosts((prev) =>
      prev.map((p) =>
        p.id === postId ? { ...p, scheduled_time: newDt.toISOString() } : p,
      ),
    );

    try {
      const res = await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduled_time: newDt.toISOString() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Reschedule failed.");
      setToast({ type: "success", message: "Post rescheduled! ✓" });
    } catch (err) {
      setPosts((prev) =>
        prev.map((p) =>
          p.id === postId ? { ...p, scheduled_time: post.scheduled_time } : p,
        ),
      );
      setToast({ type: "error", message: err instanceof Error ? err.message : "Reschedule failed." });
    }
  }, [draggingId, posts]);

  const calendarDays = buildCalendarDays(year, month);
  const todayKey = toLocalDateKey(now);

  const postsByDay = posts.reduce<Record<string, Post[]>>((acc, post) => {
    const key = postDateKey(post.scheduled_time);
    if (!acc[key]) acc[key] = [];
    acc[key].push(post);
    return acc;
  }, {});

  const monthPosts = posts.filter((p) => {
    const d = new Date(p.scheduled_time);
    return d.getFullYear() === year && d.getMonth() === month;
  });
  const statCounts = {
    scheduled: monthPosts.filter((p) => p.status === "scheduled").length,
    published: monthPosts.filter((p) => p.status === "published").length,
    failed: monthPosts.filter((p) => p.status === "failed").length,
  };

  // suppress unused warning — toastTimer is used for cleanup pattern
  void toastTimer;

  return (
    <div className="min-h-screen bg-gray-950">
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">Content Calendar</h1>
            <p className="mt-0.5 text-sm text-gray-500">Drag posts between days to reschedule them.</p>
          </div>
          <div className="flex items-center gap-2">
            <YouTubeStatusBadge />
            <button
              type="button"
              onClick={goToToday}
              className="cursor-pointer rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-sm text-gray-300 transition-colors hover:border-gray-600 hover:text-white"
            >
              Today
            </button>
            <button
              type="button"
              onClick={fetchPosts}
              disabled={loading}
              aria-label="Refresh posts"
              className="cursor-pointer rounded-lg border border-gray-700 bg-gray-800 p-1.5 text-gray-400 transition-colors hover:border-gray-600 hover:text-white disabled:opacity-40"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div className="mb-4 flex flex-wrap gap-3">
          {(["scheduled", "published", "failed"] as const).map((status) => {
            const cfg = STATUS_CFG[status];
            return (
              <div key={status} className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${cfg.badge}`}>
                <span className={`h-2 w-2 rounded-full ${cfg.dot}`} />
                <span className="text-xs font-medium capitalize">{cfg.label}</span>
                <span className={`text-sm font-bold ${cfg.stat}`}>{statCounts[status]}</span>
              </div>
            );
          })}
          <div className="flex items-center gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
            <span className="text-xs text-gray-500">Total this month</span>
            <span className="text-sm font-bold text-white">{monthPosts.length}</span>
          </div>
        </div>

        {/* Month navigation */}
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={prevMonth}
            aria-label="Previous month"
            className="cursor-pointer rounded-lg border border-gray-700 bg-gray-800 p-1.5 text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="min-w-[160px] text-center text-lg font-semibold text-white">
            {MONTH_NAMES[month]} {year}
          </h2>
          <button
            type="button"
            onClick={nextMonth}
            aria-label="Next month"
            className="cursor-pointer rounded-lg border border-gray-700 bg-gray-800 p-1.5 text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {fetchError && (
          <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {fetchError}
          </div>
        )}

        {/* Calendar grid */}
        <div className="rounded-xl border border-gray-800 bg-gray-900/50 p-2">
          <div className="mb-1 grid grid-cols-7 gap-1">
            {DAY_NAMES.map((day) => (
              <div key={day} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-gray-600">
                {day}
              </div>
            ))}
          </div>

          {loading ? (
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 42 }).map((_, i) => (
                <div key={i} className="min-h-[120px] animate-pulse rounded-lg border border-gray-800 bg-gray-900" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-7 gap-1">
              {calendarDays.map(({ date, isCurrentMonth }) => {
                const key = toLocalDateKey(date);
                return (
                  <DayCell
                    key={key}
                    date={date}
                    isCurrentMonth={isCurrentMonth}
                    isToday={key === todayKey}
                    posts={postsByDay[key] ?? []}
                    draggingId={draggingId}
                    dragOverKey={dragOverKey}
                    onPostClick={setSelectedPost}
                    onDragStart={setDraggingId}
                    onDragOver={setDragOverKey}
                    onDragLeave={() => setDragOverKey(null)}
                    onDrop={handleDrop}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-gray-600">
          <span className="font-medium text-gray-500">Legend:</span>
          {(["scheduled", "published", "failed", "draft"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${STATUS_CFG[s].dot}`} />
              {STATUS_CFG[s].label}
            </span>
          ))}
          <span className="ml-auto italic">Drag a post to a new day to reschedule.</span>
        </div>
      </main>

      {selectedPost && (
        <PostModal post={selectedPost} onClose={() => setSelectedPost(null)} />
      )}
      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
