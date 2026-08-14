"use client";

import { useState, useEffect, useCallback, useRef } from "react";
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
  Pencil,
  Trash2,
  Loader2,
  Music2,
} from "lucide-react";
import { derivePostDisplayStatus } from "@/lib/post-status";
import PageContainer from "../../../dashboard/PageContainer";
import { ConnectionStatusBadge, YoutubeIcon } from "@/components/ConnectionStatusBadge";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Post {
  id: string;
  user_id: string;
  platform: string;
  video_url: string | null;
  youtube_video_id?: string | null;
  tiktok_publish_id?: string | null;
  tiktok_share_url?: string | null;
  title: string;
  description: string;
  tags: string;
  scheduled_time: string;
  format?: string | null;
  status: "draft" | "scheduled" | "published" | "failed" | "canceled";
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
    dot: "bg-white/70",
    badge: "border-white/20 bg-white/10 text-neutral-300",
    chip: "border-white/25 bg-white/10 text-neutral-300 hover:bg-white/15",
    stat: "text-neutral-300",
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
  canceled: {
    label: "Canceled",
    dot: "bg-neutral-600",
    badge: "border-neutral-700 bg-neutral-800 text-neutral-500",
    chip: "border-neutral-700/60 bg-neutral-800/60 text-neutral-500 line-through hover:bg-neutral-700/60",
    stat: "text-neutral-500",
  },
  draft: {
    label: "Draft",
    dot: "bg-neutral-500",
    badge: "border-neutral-700 bg-neutral-800 text-neutral-400",
    chip: "border-neutral-700 bg-neutral-800 text-neutral-400 hover:bg-neutral-700",
    stat: "text-neutral-400",
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

// Sunday→Saturday of the anchor's week. Used for the mobile view, where 42 cells
// across 7 columns leave no room to read a post chip.
function buildWeekDays(anchor: Date) {
  const start = new Date(anchor);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - start.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    return { date, isCurrentMonth: true };
  });
}

function weekRangeLabel(days: { date: Date }[]): string {
  const first = days[0].date;
  const last = days[days.length - 1].date;
  const firstMonth = MONTH_NAMES[first.getMonth()].slice(0, 3);
  const lastMonth = MONTH_NAMES[last.getMonth()].slice(0, 3);
  const end =
    first.getMonth() === last.getMonth()
      ? `${last.getDate()}`
      : `${lastMonth} ${last.getDate()}`;
  return `${firstMonth} ${first.getDate()} – ${end}, ${last.getFullYear()}`;
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

// ISO → value for <input type="datetime-local"> (local wall-clock, no tz suffix).
function toDateTimeLocalValue(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

// ─── Post Detail Modal ────────────────────────────────────────────────────────

interface PostModalProps {
  post: Post;
  onClose: () => void;
  onUpdated: (post: Post) => void;
  onToast: (toast: ToastState) => void;
}

function PostModal({ post, onClose, onUpdated, onToast }: PostModalProps) {
  const cfg = STATUS_CFG[derivePostDisplayStatus(post)] ?? STATUS_CFG.draft;
  const tags = post.tags ? post.tags.split(",").map((t) => t.trim()).filter(Boolean) : [];

  // Edit/cancel are only allowed before a post goes live and while it isn't being
  // published right now. (published / publishing / canceled / draft are locked.)
  const display = derivePostDisplayStatus(post);
  const canEdit =
    (post.status === "scheduled" || post.status === "failed") && display !== "publishing";

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const [fTitle, setFTitle] = useState(post.title);
  const [fDescription, setFDescription] = useState(post.description ?? "");
  const [fTags, setFTags] = useState(post.tags ?? "");
  const [fWhen, setFWhen] = useState(toDateTimeLocalValue(post.scheduled_time));
  const [fFormat, setFFormat] = useState<"" | "short" | "video">(
    post.format === "short" || post.format === "video" ? post.format : "",
  );

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const startEdit = () => {
    setFTitle(post.title);
    setFDescription(post.description ?? "");
    setFTags(post.tags ?? "");
    setFWhen(toDateTimeLocalValue(post.scheduled_time));
    setFFormat(post.format === "short" || post.format === "video" ? post.format : "");
    setEditing(true);
  };

  const handleSave = async () => {
    const title = fTitle.trim();
    if (!title) {
      onToast({ type: "error", message: "Title can't be empty." });
      return;
    }

    const body: Record<string, unknown> = {};
    if (title !== post.title) body.title = title;
    if (fDescription !== (post.description ?? "")) body.description = fDescription;
    if (fTags !== (post.tags ?? "")) body.tags = fTags;
    const newIso = fWhen ? new Date(fWhen).toISOString() : post.scheduled_time;
    if (newIso !== post.scheduled_time) body.scheduled_time = newIso;
    if (fFormat && fFormat !== post.format) body.format = fFormat;

    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Save failed.");
      onUpdated(data.post as Post);
      onToast({ type: "success", message: "Post updated! ✓" });
      setEditing(false);
    } catch (err) {
      onToast({ type: "error", message: err instanceof Error ? err.message : "Save failed." });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelPost = async () => {
    setCanceling(true);
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "canceled" }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "Cancel failed.");
      onUpdated(data.post as Post);
      onToast({ type: "success", message: "Post canceled." });
      onClose();
    } catch (err) {
      onToast({ type: "error", message: err instanceof Error ? err.message : "Cancel failed." });
    } finally {
      setCanceling(false);
      setConfirmingCancel(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-white placeholder-neutral-600 outline-none transition-colors focus:border-white/40";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Post details"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 shadow-2xl">
        <div className="flex items-start justify-between border-b border-white/10 p-5">
          <div className="flex items-center gap-2.5">
            {post.platform === "tiktok" ? (
              <>
                <Music2 className="h-5 w-5 text-pink-400" />
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">TikTok</span>
              </>
            ) : (
              <>
                <YoutubeIcon className="h-5 w-5 text-red-400" />
                <span className="text-xs font-medium uppercase tracking-wider text-neutral-500">YouTube</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${cfg.badge}`}>
              <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
              {cfg.label}
            </span>
            <button type="button" onClick={onClose} aria-label="Close" className="cursor-pointer rounded-md p-1 text-neutral-600 transition-colors hover:bg-neutral-800 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {editing ? (
          <div className="space-y-4 p-5">
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-600">Title</label>
              <input className={inputCls} value={fTitle} onChange={(e) => setFTitle(e.target.value)} placeholder="Video title" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-600">Scheduled date &amp; time</label>
              <input type="datetime-local" className={inputCls} value={fWhen} onChange={(e) => setFWhen(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-600">Format</label>
              <div className="flex gap-2">
                {(["short", "video"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setFFormat(opt)}
                    className={`flex-1 cursor-pointer rounded-lg border px-3 py-2 text-sm font-medium capitalize transition-colors ${
                      fFormat === opt
                        ? "border-white/40 bg-white/10 text-neutral-300"
                        : "border-neutral-700 bg-neutral-800 text-neutral-400 hover:border-neutral-600"
                    }`}
                  >
                    {opt === "short" ? "Short" : "Video"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-600">Description</label>
              <textarea className={`${inputCls} min-h-[96px] resize-y`} value={fDescription} onChange={(e) => setFDescription(e.target.value)} placeholder="Caption / description" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium uppercase tracking-wider text-neutral-600">Tags (comma-separated)</label>
              <input className={inputCls} value={fTags} onChange={(e) => setFTags(e.target.value)} placeholder="tag1, tag2, tag3" />
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <h3 className="text-base font-semibold leading-snug text-white">{post.title}</h3>

            <div className="flex items-center gap-1.5 text-sm text-neutral-400">
              <Clock className="h-3.5 w-3.5 text-neutral-600" />
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
                <p className="mb-1 text-xs font-medium uppercase tracking-wider text-neutral-600">Description</p>
                <p className="text-sm leading-relaxed text-neutral-300">{post.description}</p>
              </div>
            )}

            {tags.length > 0 && (
              <div>
                <div className="mb-2 flex items-center gap-1 text-xs font-medium uppercase tracking-wider text-neutral-600">
                  <Tag className="h-3 w-3" /> Tags
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span key={tag} className="rounded-full border border-neutral-700 bg-neutral-800 px-2.5 py-0.5 text-xs text-neutral-400">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2 border-t border-white/10 p-5">
          {editing ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-gray-200 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Save changes
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={saving}
                className="cursor-pointer rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          ) : (
            <>
              {canEdit && (
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={startEdit}
                    className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-neutral-900 transition-colors hover:bg-gray-200"
                  >
                    <Pencil className="h-4 w-4" />
                    Edit post
                  </button>
                  {confirmingCancel ? (
                    <button
                      type="button"
                      onClick={handleCancelPost}
                      disabled={canceling}
                      className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-sm font-medium text-red-300 transition-colors hover:bg-red-500/20 disabled:opacity-50"
                    >
                      {canceling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      Confirm cancel
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmingCancel(true)}
                      className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-400 transition-colors hover:border-red-500/40 hover:text-red-300"
                      aria-label="Cancel this post"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              )}
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
              {/* Only present for a confirmed-public (non-SELF_ONLY) TikTok
                  post — see openspec/changes/tiktok-view-on-tiktok. A
                  SELF_ONLY post has no public post ID to link to at all, so
                  there's intentionally no button in that case. */}
              {post.status === "published" && post.tiktok_share_url && (
                <a
                  href={post.tiktok_share_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-black px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
                >
                  <Music2 className="h-4 w-4" />
                  View on TikTok
                </a>
              )}
              {post.video_url && (
                <a
                  href={post.video_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-neutral-700 bg-neutral-800 px-4 py-2.5 text-sm font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white"
                >
                  <ExternalLink className="h-4 w-4" />
                  View source video
                </a>
              )}
            </>
          )}
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
        isDragging ? "opacity-40 ring-1 ring-white/30" : ""
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
  /** Week-list row (mobile): shorter, and labelled with its weekday. */
  compact?: boolean;
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
  compact = false,
}: DayCellProps) {
  const dateKey = toLocalDateKey(date);
  const isOver = dragOverKey === dateKey && draggingId !== null;
  const MAX_VISIBLE = 3;
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? posts : posts.slice(0, MAX_VISIBLE);
  const overflow = posts.length - MAX_VISIBLE;

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(dateKey); }}
      onDragLeave={onDragLeave}
      onDrop={(e) => { e.preventDefault(); onDrop(dateKey); }}
      className={`group relative flex flex-col gap-1 rounded-lg border p-2 transition-all duration-150 ${
        compact ? "min-h-[68px]" : "min-h-[120px]"
      } ${
        !isCurrentMonth ? "border-white/5 bg-white/[0.02]" :
        isOver ? "border-white/30 bg-white/10 ring-1 ring-white/25" :
        isToday ? "border-white/20 bg-white/5" :
        "border-white/10 bg-white/[0.04] hover:border-white/20"
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2">
          {compact && (
            <span
              className={`text-[11px] font-semibold uppercase tracking-wider ${
                isToday ? "text-neutral-300" : "text-neutral-500"
              }`}
            >
              {DAY_NAMES[date.getDay()]}
            </span>
          )}
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium ${
              isToday ? "bg-white text-neutral-900" :
              isCurrentMonth ? "text-neutral-300" :
              "text-neutral-700"
            }`}
          >
            {date.getDate()}
          </span>
        </span>
        {isOver && (
          <span className="rounded text-[10px] font-medium text-neutral-300">Drop here</span>
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
        {overflow > 0 && !expanded && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded(true); }}
            className="cursor-pointer pl-1 text-left text-[10px] text-neutral-500 underline decoration-dotted transition-colors hover:text-neutral-300"
          >
            +{overflow} more
          </button>
        )}
        {expanded && posts.length > MAX_VISIBLE && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setExpanded(false); }}
            className="cursor-pointer pl-1 text-left text-[10px] text-neutral-500 underline decoration-dotted transition-colors hover:text-neutral-300"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulerCalendarPage() {
  const now = new Date();
  // One anchor drives both views: the month it falls in (desktop grid) and the
  // week it falls in (mobile list), so switching between them stays in place.
  const [anchor, setAnchor] = useState<Date>(now);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();

  // Phones get a week view — 42 cells across 7 columns leaves a chip unreadable.
  const [isWeekView, setIsWeekView] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsWeekView(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

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

  // Steps a week at a time in the mobile view, a month at a time on desktop.
  const shiftPeriod = (dir: -1 | 1) =>
    setAnchor((a) => {
      if (!isWeekView) return new Date(a.getFullYear(), a.getMonth() + dir, 1);
      const next = new Date(a);
      next.setDate(next.getDate() + dir * 7);
      return next;
    });
  const goToToday = () => setAnchor(new Date());

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

  // Reflect an edit/cancel into both the calendar grid and the open modal.
  const handlePostUpdated = useCallback((updated: Post) => {
    setPosts((prev) => prev.map((p) => (p.id === updated.id ? { ...p, ...updated } : p)));
    setSelectedPost((cur) => (cur && cur.id === updated.id ? { ...cur, ...updated } : cur));
  }, []);

  const calendarDays = isWeekView
    ? buildWeekDays(anchor)
    : buildCalendarDays(year, month);
  const periodLabel = isWeekView
    ? weekRangeLabel(calendarDays)
    : `${MONTH_NAMES[month]} ${year}`;
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
    <div className="min-h-screen">
      <PageContainer>
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="mb-3 bg-gradient-to-b from-white to-gray-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent">
              Content Calendar
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <ConnectionStatusBadge platform="youtube" />
            <ConnectionStatusBadge platform="tiktok" />
            <ConnectionStatusBadge platform="instagram" />
            <button
              type="button"
              onClick={goToToday}
              className="cursor-pointer rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-neutral-600 hover:text-white"
            >
              Today
            </button>
            <button
              type="button"
              onClick={fetchPosts}
              disabled={loading}
              aria-label="Refresh posts"
              className="cursor-pointer rounded-lg border border-neutral-700 bg-neutral-800 p-1.5 text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white disabled:opacity-40"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {/* Stats + period navigation — one row, nav trailing on the right */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
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
            <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-3 py-2">
              <span className="text-xs text-neutral-500">Total this month</span>
              <span className="text-sm font-bold text-white">{monthPosts.length}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => shiftPeriod(-1)}
              aria-label={isWeekView ? "Previous week" : "Previous month"}
              className="cursor-pointer rounded-lg border border-neutral-700 bg-neutral-800 p-1.5 text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <h2 className="min-w-[150px] text-center text-lg font-semibold text-white">
              {periodLabel}
            </h2>
            <button
              type="button"
              onClick={() => shiftPeriod(1)}
              aria-label={isWeekView ? "Next week" : "Next month"}
              className="cursor-pointer rounded-lg border border-neutral-700 bg-neutral-800 p-1.5 text-neutral-400 transition-colors hover:border-neutral-600 hover:text-white"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>

        {fetchError && (
          <div className="mb-4 flex items-center gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
            <AlertCircle className="h-4 w-4 shrink-0" />
            {fetchError}
          </div>
        )}

        {/* Calendar grid */}
        <div className="rounded-xl bg-white/[0.03] p-2">
          {/* The week view labels each row with its own weekday instead. */}
          {!isWeekView && (
            <div className="mb-1 grid grid-cols-7 gap-1">
              {DAY_NAMES.map((day) => (
                <div key={day} className="py-2 text-center text-[11px] font-semibold uppercase tracking-wider text-neutral-600">
                  {day}
                </div>
              ))}
            </div>
          )}

          {loading ? (
            <div className={isWeekView ? "flex flex-col gap-1" : "grid grid-cols-7 gap-1"}>
              {Array.from({ length: isWeekView ? 7 : 42 }).map((_, i) => (
                <div
                  key={i}
                  className={`animate-pulse rounded-lg bg-white/[0.04] ${
                    isWeekView ? "min-h-[68px]" : "min-h-[120px]"
                  }`}
                />
              ))}
            </div>
          ) : (
            <div className={isWeekView ? "flex flex-col gap-1" : "grid grid-cols-7 gap-1"}>
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
                    compact={isWeekView}
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-neutral-600">
          <span className="font-medium text-neutral-500">Legend:</span>
          {(["scheduled", "published", "failed", "canceled", "draft"] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`h-2 w-2 rounded-full ${STATUS_CFG[s].dot}`} />
              {STATUS_CFG[s].label}
            </span>
          ))}
          <span className="ml-auto italic">Drag a post to a new day to reschedule.</span>
        </div>
      </PageContainer>

      {selectedPost && (
        <PostModal
          post={selectedPost}
          onClose={() => setSelectedPost(null)}
          onUpdated={handlePostUpdated}
          onToast={setToast}
        />
      )}
      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
