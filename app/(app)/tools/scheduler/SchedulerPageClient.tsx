"use client";

import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { consumePendingDraft } from "@/lib/pending-form-draft";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { fetchSignedUrl } from "@/lib/storage-sign-client";
import {
  MEDIA_CACHE_CONTROL,
  isStorageRelativePath,
  storagePathFromStorageUrl,
} from "@/lib/storage-buckets";
import type { CreationHistoryItem } from "@/lib/creations";
import { derivePostDisplayStatus } from "@/lib/post-status";
import {
  classifyTikTokCreatorInfoHttp,
  tiktokCreatorInfoBlocksSchedule,
  tiktokCreatorInfoPrivacyPlaceholder,
  type TikTokCreatorInfoHttpKind,
} from "@/lib/tiktok-creator-info-pure";
import CreationsHistory from "@/components/CreationsHistory";
import { ConnectionStatusBadge, InstagramIcon } from "@/components/ConnectionStatusBadge";
import { planDroppedItems, splitCarouselPhotos } from "@/lib/scheduler-carousel-pure";
import { getMissingFields, MISSING_FIELD_MESSAGES, type MissingField } from "@/lib/schedule-validation-pure";
import { isPlatformUsable, platformBadge, soleSelectablePlatform, type Platform } from "@/lib/platform-availability-pure";
import { INSTAGRAM_CAROUSEL_MAX_ITEMS } from "@/lib/instagram-publish-pure";
import PageContainer from "../../dashboard/PageContainer";
import PageHeader from "../../dashboard/PageHeader";
import {
  Upload,
  Zap,
  RefreshCw,
  Calendar,
  Clock,
  Tag,
  FileVideo,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  X,
  CalendarDays,
  ExternalLink,
  ArrowRight,
  Info,
  Music2,
  Image as ImageIcon,
  Plus,
  FolderOpen,
} from "lucide-react";

// ─── Icons ───────────────────────────────────────────────────────────────────

function YoutubeIcon({ className = "" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────

type UploadStatus = "idle" | "uploading" | "done" | "error";

interface ScheduleForm {
  date: string;
  time: string;
}

interface ToastState {
  type: "success" | "error";
  message: string;
}

// Task 1.1: Post interface
interface Post {
  id: string;
  title: string;
  status: "draft" | "scheduled" | "published" | "failed" | "canceled";
  scheduled_time: string;
  youtube_video_id?: string | null;
  platform: string;
  last_error?: string | null;
  publish_started_at?: string | null;
}

// Bulk scheduling: one record per video (single mode = one item)
// Per-card scheduling lifecycle for bulk "Schedule All" (Prompt 3)
type ScheduleStatus = "idle" | "scheduling" | "scheduled" | "failed";

// Per-platform submission outcome for a multi-platform VideoItem. Client-side
// only, scoped to the scheduling UI — never persisted. Lets a retry resubmit
// only the platforms that failed, never re-POSTing one that already created a
// `posts` row (see openspec/changes/fix-schedule-retry-duplication/design.md).
type PlatformResult = { status: "success" | "failed"; error?: string };

// Publish target. YouTube auto-classifies Short vs regular video from aspect +
// duration; we upload identically either way. `format` only drives our UI,
// validation copy, caption style, and the auto-appended #Shorts tag.
type VideoFormat = "short" | "video";

interface VideoItem {
  id: string;
  file: File | null;
  videoUrl: string | null;
  /** Canonical bucket path — used for scheduling + preview re-sign. */
  storagePath: string | null;
  uploadStatus: UploadStatus;
  uploadError: string | null;
  duration: number | null;
  // Measured pixel dimensions (from <video> metadata), used to auto-suggest
  // the format and to warn when a Short isn't vertical. null until known.
  aspect: { w: number; h: number } | null;
  // Publish target. Defaults to "short" (preserves the original intent) and is
  // re-suggested from metadata until the user manually overrides it.
  format: VideoFormat;
  // Once true, auto-suggest stops touching `format` — the manual choice wins.
  formatTouched: boolean;
  title: string;
  tags: string;
  caption: string;
  date: string;
  time: string;
  scheduleStatus: ScheduleStatus;
  scheduleError: string | null;
  // Publish target platform(s) — multi-select: scheduling with both checked
  // creates one independent post per platform (see handleSubmit/
  // handleScheduleAll). TikTok-only fields below are only meaningful when
  // "tiktok" is included and are never defaulted silently — the user must
  // choose them (see openspec/changes/tiktok-publish/design.md).
  // "instagram" added per openspec/changes/connect-instagram Phase 4 task
  // 9.1 — single-mode selectable only so far (see PlatformFields'
  // instagramConnected prop); bulk mode intentionally not wired yet.
  platforms: Array<"youtube" | "tiktok" | "instagram">;
  // YouTube-only. Unlike tiktokPrivacyLevel this always has a value — it
  // defaults to "public" (the prior hardcoded behavior) rather than forcing
  // a choice, since there's no external API call needed to know the options.
  youtubePrivacyStatus: "public" | "unlisted" | "private";
  tiktokPrivacyLevel: string | null;
  tiktokBrandOrganicToggle: boolean;
  tiktokBrandContentToggle: boolean;
  // Whether the "Disclose video content" section is expanded. Lifted (not
  // local component state) so the submit gate can detect TikTok's required
  // "toggle on but neither option chosen" block — see PlatformFields.
  tiktokDiscloseOpen: boolean;
  // Interaction toggles — TikTok's own UX guideline: "Allow Comment/Duet/
  // Stitch", none checked by default. Duet/Stitch are never shown (or sent)
  // for a photo post — see PlatformFields and the submit payload builders.
  tiktokAllowComment: boolean;
  tiktokAllowDuet: boolean;
  tiktokAllowStitch: boolean;
  // Photo-post only (see contentType below): whether to let TikTok auto-add
  // recommended music to the carousel. Defaults true, matching the
  // previously-hardcoded behavior — now a real, cancelable choice instead.
  tiktokAutoAddMusic: boolean;
  // Express consent for TikTok's Music Usage Confirmation declaration — an
  // act, not real data (never sent to the API), but lifted here rather than
  // local component state so bulk mode's "Schedule All" gate can check it
  // per-item, same as tiktokDiscloseOpen above.
  tiktokConsentChecked: boolean;
  // Per-platform submission outcome, so a retry only resends to platforms
  // that haven't already succeeded.
  platformResults: Partial<Record<"youtube" | "tiktok" | "instagram", PlatformResult>>;
  // TikTok-only (openspec/changes/tiktok-photo-post): "photo" swaps the single
  // video for a multi-photo carousel (photoUrls, 1-35, first = cover).
  // Auto-derived from whatever file/asset was actually dropped or picked
  // (see handleFilesAdded/handleAssetSelected) — never set by a manual
  // toggle. YouTube has no photo-post concept, enforced by PlatformFields
  // disabling the YouTube checkbox outright while contentType is "photo".
  contentType: "video" | "photo";
  photoUrls: string[];
}

/**
 * Anything that can become a schedulable card: a library pick (full creation), a
 * bare URL/storage path (always a video), or the minimal shape a deep-link
 * hand-off can supply.
 */
type SchedulableSource =
  | string
  | (Pick<CreationHistoryItem, "mediaType" | "mediaUrl"> & { storagePath?: string | null });

const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/avi", "video/x-msvideo"];
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEOS = 5;

function makeDraft(date: string, time: string = nextScheduleSlot().time): VideoItem {
  return {
    id: crypto.randomUUID(),
    file: null,
    videoUrl: null,
    storagePath: null,
    uploadStatus: "idle",
    uploadError: null,
    duration: null,
    aspect: null,
    format: "short",
    formatTouched: false,
    title: "",
    tags: "",
    caption: "",
    date,
    time,
    scheduleStatus: "idle",
    scheduleError: null,
    platforms: ["youtube"],
    youtubePrivacyStatus: "public",
    tiktokPrivacyLevel: null,
    tiktokBrandOrganicToggle: false,
    tiktokBrandContentToggle: false,
    tiktokDiscloseOpen: false,
    tiktokAllowComment: false,
    tiktokAllowDuet: false,
    tiktokAllowStitch: false,
    tiktokAutoAddMusic: true,
    tiktokConsentChecked: false,
    platformResults: {},
    contentType: "video",
    photoUrls: [],
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function creationPhotoRef(item: CreationHistoryItem): string {
  return item.storagePath?.trim() || item.mediaUrl;
}

// "35" cap and "first = cover" carousel concept are only meaningful once
// there's more than one photo — surfacing them at count 0-1 reads as noise
// on a fresh single-photo drop, so this only leans on them once they apply.
function photoCountLabel(count: number): string {
  if (count === 0) return "Pick photos for this TikTok post — the first one you select is the cover.";
  if (count === 1) return "1 photo selected · add more to create a carousel (up to 35)";
  // Explicit, not just implied by the "Split into separate posts" undo
  // button's wording — a grilled decision after live feedback that the
  // default (one combined post) wasn't stated up front.
  return `These ${count} photos will be posted together as one carousel (max 35) · first = cover`;
}

// Direct-to-Supabase upload: the server only mints a tiny signed-URL payload
// via /api/upload/sign, then the file bytes go browser → Storage via
// uploadToSignedUrl. This bypasses the serverless request-body limit
// (~4.5 MB on Vercel) that the old multipart /api/upload POST hit for larger
// files. Shared by handleFilesAdded (new cards) and UploadCard's per-card
// "add more photos → Upload new" flow (appends to an existing card).
async function signAndUploadFile(
  file: File,
  mediaType: "video" | "image",
): Promise<{ url: string; storagePath: string }> {
  const signRes = await fetch("/api/upload/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
      mediaType,
    }),
  });

  // Guard against a non-JSON error body (e.g. an upstream error page) so the
  // user sees a readable message instead of a JSON-parse exception.
  const signData = await signRes.json().catch(() => null);
  if (!signRes.ok || !signData) {
    throw new Error((signData && signData.error) || "Couldn't start the upload. Please try again.");
  }

  const { bucket, path, token, storagePath } = signData as {
    bucket: string;
    path: string;
    token: string;
    storagePath?: string;
  };

  const { error: uploadError } = await getSupabaseBrowser()
    .storage.from(bucket)
    .uploadToSignedUrl(path, token, file, {
      contentType: file.type,
      cacheControl: MEDIA_CACHE_CONTROL,
    });

  if (uploadError) throw new Error(uploadError.message || "Upload failed.");
  const resolvedPath = storagePath ?? path;
  const signed = await fetchSignedUrl({ path: resolvedPath });
  return { url: signed.url, storagePath: resolvedPath };
}

/** Preview a scheduler photo ref (storage path or legacy signed URL). */
function SchedulerPhotoImg({
  src,
  className,
  alt = "",
}: {
  src: string;
  className?: string;
  alt?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (src.startsWith("http")) {
        setUrl(src);
        return;
      }
      if (isStorageRelativePath(src)) {
        try {
          const signed = await fetchSignedUrl({ path: src });
          if (!cancelled) setUrl(signed.url);
        } catch {
          if (!cancelled) setUrl(null);
        }
        return;
      }
      setUrl(src);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [src]);

  if (!url) {
    return <div className={className} aria-hidden />;
  }
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={alt} className={className} />;
}

// YouTube Shorts cap (current limit is 3 minutes).
const SHORT_MAX_SECONDS = 180;

// Auto-suggest the publish format from metadata: a vertical clip no longer than
// the Shorts cap suggests "short"; landscape OR longer suggests "video".
// Unknown aspect falls back to duration alone (so a short, dimensionless clip
// still suggests "short").
function suggestFormat(
  durationSec: number | null,
  aspect: { w: number; h: number } | null,
): VideoFormat {
  const isPortrait = aspect ? aspect.h > aspect.w : true;
  const withinShort = durationSec === null || durationSec <= SHORT_MAX_SECONDS;
  return isPortrait && withinShort ? "short" : "video";
}

// Ensure a Short's description carries #Shorts (case-insensitive), appending it
// once if absent. Reinforces YouTube's Short classification + discovery.
function withShortsTag(description: string): string {
  if (/#shorts\b/i.test(description)) return description;
  const base = description.trim();
  return base ? `${base}\n\n#Shorts` : "#Shorts";
}

// Advisory (non-blocking) warning for a card. Only "short" produces warnings;
// "video" and unknown metadata produce none.
function formatWarning(
  format: VideoFormat,
  durationSec: number | null,
  aspect: { w: number; h: number } | null,
): string | null {
  if (format !== "short") return null;
  if (durationSec !== null && durationSec > SHORT_MAX_SECONDS) {
    return `⚠️ Over 3 min (${fmtDuration(durationSec)}) — YouTube will publish this as a regular video, not a Short.`;
  }
  if (aspect && aspect.h <= aspect.w) {
    return "⚠️ Not vertical — Shorts should be 9:16. It may publish as a regular video.";
  }
  return null;
}

// <input type="date"> expects a local "YYYY-MM-DD" string.
function toDateInput(d: Date): string {
  const p = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Auto-spacing (Prompt 4): max 2 videos per day at these slots, rolling to the
// next day once both are taken. `index` is the card's position in the batch.
const SCHEDULE_SLOTS = ["12:00", "18:00"];

function spacedSlot(anchorDate: string, index: number): { date: string; time: string } {
  const d = new Date(`${anchorDate}T00:00:00`);
  d.setDate(d.getDate() + Math.floor(index / SCHEDULE_SLOTS.length));
  return { date: toDateInput(d), time: SCHEDULE_SLOTS[index % SCHEDULE_SLOTS.length] };
}

// Smart default for a fresh schedule form: the nearest upcoming slot from
// SCHEDULE_SLOTS, today if it hasn't passed yet, otherwise the first slot
// tomorrow. Fixes a form that used to pre-fill a fixed "today at 18:00" —
// once 18:00 had actually passed, that silently pre-filled a time already in
// the past, which makes no sense for a feature whose whole point is
// scheduling for later.
function nextScheduleSlot(now: Date = new Date()): { date: string; time: string } {
  const todayStr = toDateInput(now);
  for (const slot of SCHEDULE_SLOTS) {
    if (new Date(`${todayStr}T${slot}:00`) > now) {
      return { date: todayStr, time: slot };
    }
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { date: toDateInput(tomorrow), time: SCHEDULE_SLOTS[0] };
}

// "Best Time" is a deliberate recommendation (the evening slot specifically),
// distinct from nextScheduleSlot's "just the nearest slot" — but it must
// follow the same rule: never suggest a time that has already passed today.
function bestTimeSlot(now: Date = new Date()): { date: string; time: string; isToday: boolean } {
  const BEST_TIME = "18:00";
  const todayStr = toDateInput(now);
  if (new Date(`${todayStr}T${BEST_TIME}:00`) > now) {
    return { date: todayStr, time: BEST_TIME, isToday: true };
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { date: toDateInput(tomorrow), time: BEST_TIME, isToday: false };
}

function fmtScheduledTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Toast ───────────────────────────────────────────────────────────────────

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 4500);
    return () => clearTimeout(t);
  }, [onDismiss]);

  const isSuccess = toast.type === "success";

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border px-4 py-3 shadow-xl transition-all duration-300 ${
        isSuccess
          ? "border-success/30 bg-success/10 text-success"
          : "border-error/30 bg-error/10 text-error"
      }`}
    >
      {isSuccess ? (
        <CheckCircle2 className="h-4 w-4 shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0" />
      )}
      <span className="text-sm font-medium">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="cursor-pointer opacity-60 transition-opacity hover:opacity-100"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─── Card shell ───────────────────────────────────────────────────────────────

function Card({ children, className = "", id }: { children: React.ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={`rounded-xl bg-white/[0.04] ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-white/10 px-5 py-4">
      <span className="text-text-secondary">{icon}</span>
      <h2 className="text-sm font-semibold text-N900">{title}</h2>
    </div>
  );
}

// ─── Info tooltip ─────────────────────────────────────────────────────────────

const TAGS_TOOLTIP =
  "Tags are YouTube metadata keywords (not visible to viewers). They help the algorithm categorize your video and improve AI caption generation.";

function InfoTooltip({ text, label = "More information" }: { text: string; label?: string }) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        aria-label={label}
        className="cursor-help text-text-disabled transition-colors hover:text-text-secondary focus:outline-none focus-visible:text-text-secondary"
      >
        <Info className="h-3 w-3" aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 w-60 rounded-lg border border-white/10 bg-white/10 px-3 py-2 text-[11px] font-normal leading-relaxed text-text-secondary opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

// ─── Upload Card ──────────────────────────────────────────────────────────────

interface UploadCardProps {
  file: File | null;
  videoUrl: string | null;
  /** Canonical bucket path — used for scheduling + preview re-sign. */
  storagePath: string | null;
  uploadStatus: UploadStatus;
  uploadError: string | null;
  // Bulk: report one or more selected files to the parent
  onFilesAdded: (files: File[]) => void;
  onRemove: () => void;
  // Report measured duration + aspect to the parent (drives format auto-suggest)
  onMetaChange: (meta: { duration: number | null; aspect: { w: number; h: number } | null }) => void;
  // Asset source: report a picked creation (video or photo) to the parent.
  onAssetSelected: (item: CreationHistoryItem) => void;
  // Active publish format — switches the preview frame (9:16 short / 16:9 video)
  format: VideoFormat;
  // TikTok photo posts (openspec/changes/tiktok-photo-post): when "photo",
  // this card shows a multi-select photo picker instead of the video
  // upload/asset UI entirely. Optional + defaulted so bulk mode's "add more
  // videos" UploadCard (which never sets these) is completely unaffected.
  contentType?: "video" | "photo";
  photoUrls?: string[];
  onPhotoUrlsChange?: (urls: string[]) => void;
  // Undo for handleFilesAdded's "2+ photos become one carousel" default —
  // optional/undefined for the same reason as onPhotoUrlsChange above
  // (bulk mode's own "add more videos" UploadCard never sets it).
  onSplitCarousel?: () => void;
}

function UploadCard({
  file,
  videoUrl,
  storagePath,
  uploadStatus,
  uploadError,
  onFilesAdded,
  onRemove,
  onMetaChange,
  onAssetSelected,
  format,
  contentType = "video",
  photoUrls = [],
  onPhotoUrlsChange,
  onSplitCarousel,
}: UploadCardProps) {
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const [isDragging, setIsDragging] = useState(false);
  const [tab, setTab] = useState<"upload" | "assets">("upload");
  // Task 2.1: local object URL for instant preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Photo picker (single mode only — openspec/changes/tiktok-photo-post):
  // "add more photos" starts collapsed to a single button and only reveals
  // the upload-vs-library choice, then the relevant UI, once the user asks
  // for it — instead of eagerly showing the full asset grid up front.
  const [addPhotoMode, setAddPhotoMode] = useState<"closed" | "choice" | "library">("closed");
  const [addPhotoStatus, setAddPhotoStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [addPhotoError, setAddPhotoError] = useState<string | null>(null);
  const newPhotoInputRef = useRef<HTMLInputElement>(null);

  // Unified dropzone (openspec/changes/tiktok-photo-post Decision 6): accepts
  // both video and image files — the parent (`onFilesAdded`) derives each
  // file's contentType from its actual MIME type, not from anything chosen
  // here. This card never decides "video" vs "photo" itself.
  const ACCEPTED_TYPES = [
    "video/mp4", "video/quicktime", "video/avi", "video/x-msvideo",
    "image/jpeg", "image/png", "image/webp",
  ];

  // Preview source: a device File's object URL, or — for an asset-backed item
  // with no File — the hosted videoUrl directly. Duration is captured the same
  // way (<video onLoadedMetadata>) in both cases.
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    if (storagePath) {
      let cancelled = false;
      fetchSignedUrl({ path: storagePath })
        .then((r) => { if (!cancelled) setPreviewUrl(r.url); })
        .catch(() => { if (!cancelled) setPreviewUrl(videoUrl); });
      return () => { cancelled = true; };
    }
    if (videoUrl) {
      setPreviewUrl(videoUrl);
      return;
    }
    setPreviewUrl(null);
    setDuration(null);
    onMetaChange({ duration: null, aspect: null });
  }, [file, storagePath, videoUrl, onMetaChange]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = Array.from(e.dataTransfer.files).filter((f) =>
        ACCEPTED_TYPES.includes(f.type),
      );
      if (dropped.length > 0) onFilesAdded(dropped);
    },
    [onFilesAdded],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    if (selected.length > 0) onFilesAdded(selected);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRemove();
    if (inputRef.current) inputRef.current.value = "";
  };

  // Capture duration + pixel dimensions from video metadata (dimensions feed
  // the format auto-suggest and the "Short isn't vertical" warning).
  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    const d = el.duration;
    const valid = isFinite(d) ? d : null;
    const aspect =
      el.videoWidth > 0 && el.videoHeight > 0
        ? { w: el.videoWidth, h: el.videoHeight }
        : null;
    setDuration(valid);
    onMetaChange({ duration: valid, aspect });
  };

  // "Upload new" branch of the add-photos choice (single mode only): appends
  // freshly-uploaded raw photo(s) directly onto this card's photoUrls,
  // instead of creating new cards the way the main dropzone's onFilesAdded
  // does. Mirrors handleFilesAdded's sign-and-upload flow via the shared
  // signAndUploadFile helper, but targets THIS card via onPhotoUrlsChange.
  const handleAddPhotoFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    if (newPhotoInputRef.current) newPhotoInputRef.current.value = "";
    if (selected.length === 0) return;

    const room = Math.max(0, 35 - photoUrls.length);
    const accepted = selected.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type)).slice(0, room);
    if (accepted.length === 0) return;

    setAddPhotoStatus("uploading");
    setAddPhotoError(null);
    const uploaded: string[] = [];
    let firstError: string | null = null;
    for (const f of accepted) {
      try {
        const { storagePath } = await signAndUploadFile(f, "image");
        uploaded.push(storagePath);
      } catch (err) {
        firstError = err instanceof Error ? err.message : "Upload failed.";
      }
    }
    if (uploaded.length > 0) onPhotoUrlsChange?.([...photoUrls, ...uploaded]);
    if (firstError) {
      setAddPhotoStatus("error");
      setAddPhotoError(firstError);
    } else {
      setAddPhotoStatus("idle");
    }
  };

  // True once a video is selected, whether or not it's actually been
  // uploaded to Storage yet — upload is deferred until "Schedule" is clicked
  // (see handleFilesAdded/ScheduleCard.handleSubmit), so a staged `file`
  // alone (uploadStatus still "idle") already counts as "ready" here.
  const hasSelectedMedia = !!(file || videoUrl || storagePath);

  const dropZoneClass =
    isDragging ? "border-white/40 bg-white/10" :
    uploadStatus === "error" ? "border-error/40 bg-error/5" :
    uploadStatus === "uploading" ? "border-white/25 bg-white/5 cursor-not-allowed" :
    hasSelectedMedia ? "border-success/40 bg-success/5" :
    "border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10";

  // TikTok photo post: entirely different media source (multi-select photo
  // carousel instead of a single video), so this replaces the whole card body
  // rather than adding a third tab alongside Upload/My Assets.
  if (contentType === "photo") {
    const togglePhoto = (url: string) => {
      const next = photoUrls.includes(url)
        ? photoUrls.filter((u) => u !== url)
        : photoUrls.length >= 35
          ? photoUrls // already at TikTok's 35-photo cap — ignore further picks
          : [...photoUrls, url];
      onPhotoUrlsChange?.(next);
    };

    return (
      <Card>
        <div className="flex items-center justify-between gap-2.5 border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="text-text-secondary"><ImageIcon className="h-4 w-4" /></span>
            <h2 className="text-sm font-semibold text-N900">Select Photos</h2>
          </div>
          {/* Escape hatch: picking a photo (e.g. from "My Assets") permanently
              switches this card to photo mode with no other way back to the
              plain video/blank dropzone once photoUrls has no raw `file`
              (whose own remove button happens to call onRemove already). */}
          <button
            type="button"
            onClick={onRemove}
            aria-label="Cancel photo post"
            className="text-text-disabled transition-colors hover:text-N900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-5">
          {/* Feedback for a raw photo drop that triggered this mode — the
              upload itself happens in the parent's handleFilesAdded; this
              card just reflects its status. */}
          {uploadStatus === "uploading" && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-xs text-text-secondary">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
              Uploading {file?.name}…
            </div>
          )}
          {uploadStatus === "error" && (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {uploadError ?? "Upload failed."}
            </div>
          )}

          {/* Selected-photos preview strip. Renders straight from `photoUrls`
              (a raw-uploaded photo always shows here even though it's
              intentionally never written to user_creations — Decision 8,
              ephemeral — and therefore can never appear as a matching
              thumbnail in the "Choose from your library" grid below), plus a
              leading tile from the local `file` blob when a raw photo is
              staged but not yet uploaded (upload is deferred until Schedule
              is clicked — see ScheduleCard.handleSubmit). That staged file
              is always the eventual cover (position 0 once uploaded). */}
          {(photoUrls.length > 0 || file) && (
            <div className="mb-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-N900">
                  {photoCountLabel(photoUrls.length + (file ? 1 : 0))}
                </p>
                {/* Undo for the "2+ photos become one carousel" default
                    (handleFilesAdded's makeCarousel) — visible, not buried,
                    since it's a real reversal of what just happened, not a
                    minor setting. */}
                {photoUrls.length > 1 && onSplitCarousel && (
                  <button
                    type="button"
                    onClick={onSplitCarousel}
                    className="shrink-0 text-xs font-medium text-text-secondary underline decoration-dotted transition-colors hover:text-text-primary"
                  >
                    Split into separate posts
                  </button>
                )}
              </div>
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {file && previewUrl && (
                  <div className="group relative aspect-[4/5] overflow-hidden rounded-lg border border-white/10 bg-N0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={previewUrl} alt="" className="h-full w-full object-cover" />
                    {(photoUrls.length > 0 || uploadStatus === "uploading") && (
                      <span className="absolute left-1 top-1 rounded bg-N0/70 px-1.5 py-0.5 text-[9px] font-medium text-N900">
                        {uploadStatus === "uploading" ? "Uploading…" : "Cover"}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={handleRemove}
                      aria-label="Remove photo"
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-N0/70 text-N900/80 opacity-0 backdrop-blur-sm transition-opacity hover:text-N900 group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
                {photoUrls.map((url, i) => (
                  <div
                    key={url}
                    className="group relative aspect-[4/5] overflow-hidden rounded-lg border border-white/10 bg-N0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <SchedulerPhotoImg src={url} alt="" className="h-full w-full object-cover" />
                    {i === 0 && !file && photoUrls.length > 1 && (
                      <span className="absolute left-1 top-1 rounded bg-N0/70 px-1.5 py-0.5 text-[9px] font-medium text-N900">
                        Cover
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => onPhotoUrlsChange?.(photoUrls.filter((u) => u !== url))}
                      aria-label="Remove photo"
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-N0/70 text-N900/80 opacity-0 backdrop-blur-sm transition-opacity hover:text-N900 group-hover:opacity-100"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {photoUrls.length === 0 && !file && uploadStatus !== "uploading" && (
            <p className="mb-3 text-xs text-warning">Add at least one photo to schedule this post.</p>
          )}

          {/* Choice-first add-more flow: collapsed to one button by default,
              only reveals the upload-vs-library choice (then the relevant
              UI) once asked for — instead of always eagerly rendering the
              full asset grid. */}
          {addPhotoMode === "closed" && (
            <button
              type="button"
              onClick={() => {
                // Both branches this opens (upload / choose from library) hit
                // an authed API immediately — gate the single entry point.
                if (status !== "authenticated") {
                  openSignInModal();
                  return;
                }
                setAddPhotoMode(photoUrls.length >= 35 ? "closed" : "choice");
              }}
              disabled={photoUrls.length >= 35}
              className="flex w-full items-center justify-center gap-1.5 rounded-radius-xl border border-dashed border-white/10 px-3 py-2.5 text-xs font-medium text-text-secondary transition-colors hover:border-white/20 hover:text-N900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              Add photos
            </button>
          )}

          {addPhotoMode === "choice" && (
            <div className="rounded-lg border border-white/10 bg-white/5 p-3.5">
              <div className="mb-2.5 flex items-center justify-between">
                <p className="text-sm font-semibold text-N900">Add photos to this post</p>
                <button
                  type="button"
                  onClick={() => setAddPhotoMode("closed")}
                  aria-label="Cancel"
                  className="text-text-disabled transition-colors hover:text-N900"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAddPhotoMode("closed");
                    newPhotoInputRef.current?.click();
                  }}
                  className="flex flex-col items-center gap-1.5 rounded-radius-xl border border-white/10 bg-white/10 px-3 py-3 text-xs font-medium text-text-secondary transition-colors hover:border-white/30 hover:text-N900"
                >
                  <Upload className="h-4 w-4" />
                  Upload new
                </button>
                <button
                  type="button"
                  onClick={() => setAddPhotoMode("library")}
                  className="flex flex-col items-center gap-1.5 rounded-radius-xl border border-white/10 bg-white/10 px-3 py-3 text-xs font-medium text-text-secondary transition-colors hover:border-white/30 hover:text-N900"
                >
                  <FolderOpen className="h-4 w-4" />
                  Choose from your library
                </button>
              </div>
            </div>
          )}

          {addPhotoMode === "library" && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-N900">Pick photos to include in this TikTok post</p>
                <button
                  type="button"
                  onClick={() => setAddPhotoMode("closed")}
                  className="text-xs font-medium text-text-secondary transition-colors hover:text-text-secondary"
                >
                  Done
                </button>
              </div>
              {/* No `tools` allowlist: any image-producing tool (product_photo,
                  storyboard, and any future one) should be pickable here —
                  mediaType="image" alone is what actually matters. An explicit
                  tool-id list drifts out of sync every time a new tool ships
                  (see openspec/changes/tiktok-photo-post bug history: it
                  missed "storyboard" images entirely until this fix). */}
              <CreationsHistory
                hideHeader
                mediaType="image"
                limit={24}
                multiSelect
                selectedUrls={photoUrls}
                onSelect={(item) => togglePhoto(creationPhotoRef(item))}
                showCreateCta
                className="!mt-0 !border-t-0 !pt-0"
              />
            </div>
          )}

          {addPhotoStatus === "uploading" && (
            <p className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Uploading…
            </p>
          )}
          {addPhotoStatus === "error" && (
            <p className="mt-2 text-xs text-error">{addPhotoError ?? "Upload failed."}</p>
          )}
          <input
            ref={newPhotoInputRef}
            type="file"
            multiple
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            onChange={handleAddPhotoFiles}
            className="hidden"
            aria-label="Upload new photo"
          />
        </div>
      </Card>
    );
  }

  return (
    <Card id="upload-media-card">
      <CardHeader title="Upload Media" icon={<FileVideo className="h-4 w-4" />} />
      <div className="p-5">
        <div className="mb-4 inline-flex rounded-lg border border-white/10 bg-white/10 p-0.5">
          <button
            type="button"
            onClick={() => setTab("upload")}
            className={`cursor-pointer rounded-radius-xl px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "upload" ? "bg-bg-static-white text-text-static-black" : "text-text-secondary hover:text-N900"
            }`}
          >
            📁 Upload from device
          </button>
          <button
            type="button"
            onClick={() => {
              // A logged-out visitor has no assets to show — CreationsHistory
              // would just surface a dev-facing 401 error banner in that tab.
              if (status !== "authenticated") {
                openSignInModal();
                return;
              }
              setTab("assets");
            }}
            className={`cursor-pointer rounded-radius-xl px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "assets" ? "bg-bg-static-white text-text-static-black" : "text-text-secondary hover:text-N900"
            }`}
          >
            🎬 My Assets
          </button>
        </div>

        {tab === "upload" && (
        <div
          role="button"
          tabIndex={uploadStatus === "uploading" ? -1 : 0}
          aria-label="Drop zone for video or photo upload"
          onClick={() => uploadStatus !== "uploading" && inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && uploadStatus !== "uploading" && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 ${dropZoneClass}`}
        >
          {uploadStatus === "uploading" && (
            <>
              <RefreshCw className="h-8 w-8 animate-spin text-text-secondary" />
              <div>
                <p className="text-sm font-medium text-N900">Uploading…</p>
                <p className="mt-0.5 text-xs text-text-disabled">{file?.name}</p>
              </div>
              <div className="w-full max-w-xs overflow-hidden rounded-full bg-white/10">
                <div className="h-1.5 animate-[progress_1.5s_ease-in-out_infinite] rounded-full bg-white/70" />
              </div>
            </>
          )}
          {uploadStatus !== "uploading" && uploadStatus !== "error" && hasSelectedMedia && (
            <>
              <CheckCircle2 className="h-8 w-8 text-success" />
              <div>
                <p className="text-sm font-semibold text-success">
                  {uploadStatus === "done" ? "✓ Video ready" : "✓ Video selected"}
                </p>
                <p className="mt-0.5 text-xs text-text-secondary">{file?.name}</p>
                <p className="mt-0.5 text-xs text-text-disabled">
                  {file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : ""}
                </p>
              </div>
              <button type="button" onClick={handleRemove} className="cursor-pointer rounded-radius-xl px-3 py-1 text-xs text-text-secondary transition-colors hover:bg-white/10 hover:text-N900">
                Remove
              </button>
            </>
          )}
          {uploadStatus === "error" && (
            <>
              <AlertCircle className="h-8 w-8 text-error" />
              <div>
                <p className="text-sm font-medium text-error">Upload failed</p>
                <p className="mt-0.5 text-xs text-text-disabled">{uploadError}</p>
              </div>
              <button type="button" onClick={handleRemove} className="cursor-pointer rounded-radius-xl px-3 py-1 text-xs text-text-secondary transition-colors hover:bg-white/10 hover:text-N900">
                Try again
              </button>
            </>
          )}
          {uploadStatus !== "uploading" && uploadStatus !== "error" && !hasSelectedMedia && (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10">
                <Upload className="h-5 w-5 text-text-secondary" />
              </div>
              <div>
                <p className="text-sm font-medium text-N900">Drop your video or photo here</p>
                <p className="mt-0.5 text-xs text-text-disabled">or click to browse</p>
              </div>
            </>
          )}
        </div>
        )}

        {tab === "assets" && (
          // No mediaType filter (mixes videos and photos in one gallery) and
          // no `tools` allowlist either: every generation tool produces
          // something schedulable (a photo or a video), so this shows
          // everything rather than hand-maintaining a duplicate tool-id list
          // that silently drops assets whenever a new tool ships — that's
          // exactly what happened here (missed "video_image2video", then
          // "storyboard", across two rounds of this same bug). Picking any
          // item derives contentType from that asset's own kind (see
          // onAssetSelected), same as a raw drop would.
          <CreationsHistory
            title="Your assets"
            description="Pick a generated video or photo to schedule — no re-upload needed."
            limit={24}
            selectedUrl={videoUrl ?? undefined}
            onSelect={(item) => onAssetSelected(item)}
            showCreateCta
            className="!mt-0 !border-t-0 !pt-0"
          />
        )}

        {/* Video preview + duration. Frame adapts to the chosen format:
            9:16 for a Short, 16:9 for a Video. object-contain letterboxes
            gracefully when the real ratio differs from the frame. */}
        {previewUrl && uploadStatus !== "uploading" && uploadStatus !== "error" && (
          <div className="mt-4 space-y-2">
            <div
              className={`mx-auto w-full overflow-hidden rounded-lg border border-white/10 bg-N0 ${
                format === "short" ? "aspect-[9/16] max-w-[240px]" : "aspect-video"
              }`}
            >
              <video
                src={previewUrl}
                controls
                onLoadedMetadata={handleLoadedMetadata}
                className="h-full w-full object-contain"
              />
            </div>
            {duration !== null && (
              <p className="text-center text-xs text-text-disabled">
                Duration: {fmtDuration(duration)}
              </p>
            )}
          </div>
        )}

        <input ref={inputRef} type="file" multiple accept=".mp4,.mov,.avi,.jpg,.jpeg,.png,.webp,video/mp4,video/quicktime,video/avi,video/x-msvideo,image/jpeg,image/png,image/webp" onChange={handleChange} className="hidden" aria-label="Media file input" />
        <p className="mt-3 text-center text-xs text-text-disabled">
          Up to 5 items · Video: MP4, MOV, AVI (≤ 50MB, Shorts ≤ 3 min) · Photo: JPEG, PNG, WebP (≤ 10MB)
        </p>
        {/* Reversed from the original tiktok-photo-post design: dropping 2+
            photos together now merges them into one carousel post, not N
            separate single-photo cards — see handleFilesAdded's makeCarousel
            branch. A single photo still stages normally; grow it afterward
            via "pick more from history" on that card. */}
        <p className="mt-1 text-center text-xs text-text-disabled">
          Dropping multiple photos combines them into one carousel post — add more later with &ldquo;pick more from history&rdquo; on that card.
        </p>
      </div>
    </Card>
  );
}

// ─── Description Card ─────────────────────────────────────────────────────────

interface DescriptionCardProps {
  caption: string;
  onCaptionChange: (caption: string) => void;
  title: string;
  tags: string;
  videoUrl: string | null;
  storagePath: string | null;
  format: VideoFormat;
  // A photo post has no video/transcript — the cover photo (first entry) is
  // sent for vision-based captioning instead (the backend already supports
  // this via photo_storage_path; hasMedia below is what previously kept the
  // Generate button disabled for every photo post regardless).
  contentType: VideoItem["contentType"];
  photoUrls: string[];
  // Upload is deferred until "Schedule Post" is clicked (see ScheduleCard's
  // handleSubmit) — so a just-picked file has neither videoUrl/storagePath
  // nor a photoUrls entry yet, only `file`. Generate needs real bytes on a
  // server the model can fetch, so it uploads on demand here rather than
  // just staying disabled until the user schedules the post.
  file: File | null;
  onMediaUploaded: (
    patch: Partial<Pick<VideoItem, "videoUrl" | "storagePath" | "photoUrls" | "file" | "uploadStatus">>,
  ) => void;
}

function DescriptionCard({
  caption,
  onCaptionChange,
  title,
  tags,
  videoUrl,
  storagePath,
  format,
  contentType,
  photoUrls,
  file,
  onMediaUploaded,
}: DescriptionCardProps) {
  // Reconciled onto the shared useCaptionAI() hook + CaptionControls (task 7.3),
  // removing the duplicated fetch logic. Behavior is preserved: Generate requires
  // a video (Whisper) or, for a photo post, the cover photo (vision), and the
  // two-branch usedTranscript warning is rendered by CaptionControls.
  const ai = useCaptionAI();
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const [uploadingForCaption, setUploadingForCaption] = useState(false);
  const isPhoto = contentType === "photo";
  const photoStoragePath = photoUrls[0] ?? null;
  // A staged-but-unuploaded file counts as media too — otherwise Generate
  // stays disabled the whole time a video/photo is only in memory, which is
  // most of the time given upload is deferred until scheduling.
  const hasMedia = isPhoto ? (photoUrls.length > 0 || !!file) : !!(storagePath || videoUrl || file);

  // Clear the transcript warning whenever the media changes (removed or replaced)
  useEffect(() => {
    ai.resetWarning();
  }, [videoUrl, storagePath, photoStoragePath, ai.resetWarning]);

  const requireAuthForCaption = () => {
    if (status === "authenticated") return true;
    openSignInModal(undefined, { title, tags, caption });
    return false;
  };

  const handleGenerate = async () => {
    if (!requireAuthForCaption()) return;
    try {
      let effectiveVideoUrl = videoUrl;
      let effectiveStoragePath = storagePath;
      let effectivePhotoStoragePath = photoStoragePath;

      // Nothing hosted yet — upload the staged file now so the model has a
      // real URL to fetch, and persist the result so a later "Schedule Post"
      // (or another Generate click) doesn't upload it again.
      if (file && !effectiveStoragePath && !effectiveVideoUrl && !effectivePhotoStoragePath) {
        setUploadingForCaption(true);
        try {
          const uploaded = await signAndUploadFile(file, isPhoto ? "image" : "video");
          if (isPhoto) {
            effectivePhotoStoragePath = uploaded.storagePath;
            onMediaUploaded({ photoUrls: [uploaded.storagePath, ...photoUrls], file: null, uploadStatus: "done" });
          } else {
            effectiveVideoUrl = uploaded.url;
            effectiveStoragePath = uploaded.storagePath;
            onMediaUploaded({ videoUrl: uploaded.url, storagePath: uploaded.storagePath, file: null, uploadStatus: "done" });
          }
        } finally {
          setUploadingForCaption(false);
        }
      }

      const next = isPhoto
        ? await ai.generate({ title, tags, videoUrl: null, storagePath: null, photoStoragePath: effectivePhotoStoragePath, format })
        : await ai.generate({ title, tags, videoUrl: effectiveVideoUrl, storagePath: effectiveStoragePath, format });
      onCaptionChange(next);
    } catch {
      // error surfaced by the hook (upload failures fall through as a plain
      // thrown error, also swallowed here — the hint text stays honest since
      // hasMedia/hasContent don't change on a failed upload)
    }
  };

  const handlePolish = async () => {
    if (!requireAuthForCaption()) return;
    try {
      const next = await ai.polish(caption);
      onCaptionChange(next);
    } catch {
      // error surfaced by the hook
    }
  };

  return (
    <Card>
      <CardHeader title="Caption" icon={<Sparkles className="h-4 w-4" />} />
      <div className="space-y-4 p-5">
        <div>
          <label htmlFor="video-caption" className="mb-1.5 block text-xs font-medium text-text-secondary">
            Caption
          </label>
          <textarea
            id="video-caption"
            value={caption}
            onChange={(e) => onCaptionChange(e.target.value)}
            placeholder="Write your caption here, or generate one with AI below..."
            rows={5}
            aria-label="Caption (editable)"
            className="w-full resize-none rounded-lg border border-white/10 bg-white/10 px-3.5 py-3 text-sm text-text-primary placeholder-text-disabled transition-colors focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/30"
          />
          <p className="mt-1 text-right text-xs text-text-disabled">
            {format === "short" ? `${caption.length} / 300 chars` : `${caption.length} chars`}
          </p>
        </div>

        <CaptionControls
          ai={ai}
          hasMedia={hasMedia}
          hasContent={!!caption.trim()}
          hasTitle={!!title.trim()}
          generateLabel="Generate Caption"
          onGenerate={handleGenerate}
          onPolish={handlePolish}
          extraBusy={uploadingForCaption}
        />
      </div>
    </Card>
  );
}

// ─── Format toggle ────────────────────────────────────────────────────────────

// Short / Video selector. Calling onChange always counts as a manual override
// (the parent flips `formatTouched` so auto-suggest stops adjusting this card).
function FormatToggle({
  value,
  onChange,
  size = "md",
}: {
  value: VideoFormat;
  onChange: (next: VideoFormat) => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs";
  const opts: { id: VideoFormat; label: string }[] = [
    { id: "short", label: "Short" },
    { id: "video", label: "Video" },
  ];
  return (
    <div
      role="group"
      aria-label="Publish format"
      className="inline-flex rounded-lg border border-white/10 bg-white/10 p-0.5"
    >
      {opts.map((o) => (
        <button
          key={o.id}
          type="button"
          aria-pressed={value === o.id}
          onClick={() => onChange(o.id)}
          className={`cursor-pointer rounded-radius-xl font-medium transition-colors ${pad} ${
            value === o.id ? "bg-bg-static-white text-text-static-black" : "text-text-secondary hover:text-N900"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ─── Platform fields (Platform + TikTok privacy/disclosure) ────────────────────

const TIKTOK_PRIVACY_LABELS: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Public",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

const YOUTUBE_PRIVACY_LABELS: Record<"public" | "unlisted" | "private", string> = {
  public: "Public",
  unlisted: "Unlisted",
  private: "Private",
};

const PLATFORM_LABELS: Record<"youtube" | "tiktok" | "instagram", string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
};

const TIKTOK_MUSIC_USAGE_URL = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const TIKTOK_BRANDED_CONTENT_POLICY_URL = "https://www.tiktok.com/legal/page/global/bc-policy/en";

// TikTok's own required pre-publish declaration + express-consent gate.
// Text is TikTok's literal required copy — never paraphrase it, and never
// swap in a self-hosted link for either policy (see the guideline audit).
// Consent is intentionally not part of VideoItem: it's an act, not data, so
// it resets on every fresh card rather than persisting.
function TikTokConsentDeclaration({
  brandContentToggle,
  checked,
  onCheckedChange,
  showError = false,
  idPrefix = "",
}: {
  brandContentToggle: boolean;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  showError?: boolean;
  idPrefix?: string;
}) {
  return (
    <div
      id={`${idPrefix}tiktok-consent`}
      className={`space-y-1.5 rounded-lg border bg-white/5 px-3.5 py-3 ${showError ? "border-error" : "border-white/10"}`}
    >
      <p className="text-[11px] text-text-disabled">Processing on TikTok can take a few minutes after you post.</p>
      <label className="flex cursor-pointer items-start gap-2 text-xs text-text-secondary">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-white/10 bg-white/10 text-N900 focus:ring-white/30"
        />
        <span>
          By posting, you agree to TikTok&apos;s{" "}
          {brandContentToggle && (
            <>
              <a
                href={TIKTOK_BRANDED_CONTENT_POLICY_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-N900"
              >
                Branded Content Policy
              </a>{" "}
              and{" "}
            </>
          )}
          <a href={TIKTOK_MUSIC_USAGE_URL} target="_blank" rel="noopener noreferrer" className="underline hover:text-N900">
            Music Usage Confirmation
          </a>
          .
        </span>
      </label>
      {showError && <p className="text-xs text-error">{MISSING_FIELD_MESSAGES.tiktokConsent}</p>}
    </div>
  );
}

type PlatformPatch = Partial<
  Pick<
    VideoItem,
    | "platforms"
    | "youtubePrivacyStatus"
    | "tiktokPrivacyLevel"
    | "tiktokBrandOrganicToggle"
    | "tiktokBrandContentToggle"
    | "tiktokDiscloseOpen"
    | "tiktokAllowComment"
    | "tiktokAllowDuet"
    | "tiktokAllowStitch"
    | "tiktokAutoAddMusic"
    | "tiktokConsentChecked"
    | "platformResults"
  >
>;

// Full creator_info-derived state for the connected TikTok account, fetched
// once at the page level and passed down to every card. postingBlocked vs.
// rateLimited get deliberately different UX: a genuine ban blocks scheduling
// outright, but a same-moment daily post cap never should — Kelolako's core
// use case is scheduling many reels/day, so hitting a transient daily cap
// must not stop someone from scheduling a post for three days from now (the
// cron's own 24h auto-retry handles it at actual publish time instead).
interface TikTokCreatorInfoState {
  privacyLevelOptions: string[];
  creatorNickname: string;
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
  postingBlocked: boolean;
  blockedReason: string | null;
  rateLimited: boolean;
  rateLimitedReason: string | null;
  httpKind: TikTokCreatorInfoHttpKind | "loading";
}

const DEFAULT_TIKTOK_CREATOR_INFO: TikTokCreatorInfoState = {
  privacyLevelOptions: [],
  creatorNickname: "",
  commentDisabled: false,
  duetDisabled: false,
  stitchDisabled: false,
  maxVideoPostDurationSec: 0,
  postingBlocked: false,
  blockedReason: null,
  rateLimited: false,
  rateLimitedReason: null,
  httpKind: "loading",
};

// Anchor DOM ids used to scroll to the first missing field when Schedule is
// clicked with the form incomplete — the Schedule button itself is always
// enabled (see CONTEXT.md-adjacent grilling decision: anchor + inline error
// beats a silently-disabled button). Several of these ids live outside
// PlatformFields/ScheduleCard (upload-media-card is on the sibling Upload
// Media card) — that's fine, scrollIntoView works across component
// boundaries via a plain DOM id lookup.
const MISSING_FIELD_ANCHOR: Record<MissingField, string> = {
  platforms: "post-platforms",
  tiktokPrivacy: "tiktok-privacy",
  tiktokBlocked: "tiktok-fields",
  tiktokDuration: "tiktok-fields",
  tiktokDisclosure: "tiktok-fields",
  media: "upload-media-card",
  title: "post-title",
  date: "schedule-date",
  time: "schedule-time",
  tiktokConsent: "tiktok-consent",
  alreadyPosted: "post-platforms",
};

function scrollToFirstMissingField(missing: MissingField[]): void {
  const first = missing[0];
  if (!first) return;
  document.getElementById(MISSING_FIELD_ANCHOR[first])?.scrollIntoView({ behavior: "smooth", block: "center" });
}

// "Soon" for a regular user (the platform is genuinely locked); "Preview"
// for an admin viewing a coming-soon platform they can actually use anyway
// (see CONTEXT.md's Admin preview) — same visual language, different label
// so an admin doesn't forget mid-testing that this isn't live for everyone.
function PlatformSoonBadge({ kind }: { kind: "soon" | "preview" }) {
  return (
    <span
      className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
        kind === "preview" ? "bg-warning/15 text-warning" : "bg-white/10 text-text-disabled"
      }`}
    >
      {kind === "preview" ? "Preview" : "Soon"}
    </span>
  );
}

// Shared by ScheduleCard (single mode) and BulkVideoCard (bulk mode) so both
// stay in sync with the same platform-choice + TikTok privacy/disclosure
// rules (see openspec/changes/tiktok-publish/design.md, Decisions 4, 4a, 7).
// Multi-select: both YouTube and TikTok can be checked at once — scheduling
// creates one independent post per checked platform.
function PlatformFields({
  platforms,
  platformResults,
  youtubePrivacyStatus,
  tiktokPrivacyLevel,
  tiktokBrandOrganicToggle,
  tiktokBrandContentToggle,
  tiktokDiscloseOpen,
  tiktokAllowComment,
  tiktokAllowDuet,
  tiktokAllowStitch,
  tiktokAutoAddMusic,
  onChange,
  tiktokConnected,
  tiktokCreatorInfo,
  instagramConnected,
  instagramUsername,
  photoCount,
  contentType,
  videoDurationSec,
  format,
  onFormatChange,
  shortWarn,
  errorFields = [],
  // Bulk mode renders many PlatformFields at once — fixed ids like
  // "post-platforms" would collide across cards (invalid HTML, and
  // getElementById would only ever find the first one). Single mode (the
  // only caller that actually scrolls to these ids — see
  // MISSING_FIELD_ANCHOR) leaves this at its default "".
  idPrefix = "",
  platformAvailability,
}: {
  platforms: VideoItem["platforms"];
  platformResults: VideoItem["platformResults"];
  youtubePrivacyStatus: VideoItem["youtubePrivacyStatus"];
  tiktokPrivacyLevel: string | null;
  tiktokBrandOrganicToggle: boolean;
  tiktokBrandContentToggle: boolean;
  // Lifted (not local UI state) so the parent card can gate its submit
  // button on "disclosure opened but neither option chosen" — TikTok's own
  // guideline requires disabling publish in exactly that state, which is
  // otherwise invisible outside this component.
  tiktokDiscloseOpen: boolean;
  tiktokAllowComment: boolean;
  tiktokAllowDuet: boolean;
  tiktokAllowStitch: boolean;
  tiktokAutoAddMusic: boolean;
  onChange: (patch: PlatformPatch) => void;
  tiktokConnected: boolean;
  tiktokCreatorInfo: TikTokCreatorInfoState;
  // Optional and single-mode-only for now (openspec/changes/connect-instagram
  // Phase 4, task 9.1-9.2): BulkVideoCard never passes this prop, so the
  // checkbox below structurally cannot render there yet — bulk mode's own
  // Instagram wiring (content-type gating, carousel limits) is a separate,
  // later task.
  instagramConnected?: boolean;
  // Instagram's own "posting as @username" panel, parity with TikTok's
  // (which sources its nickname from tiktokCreatorInfo instead). Optional,
  // same single-mode-only reasoning as instagramConnected above.
  instagramUsername?: string | null;
  // How many photos are currently staged — used only to warn (not block)
  // when Instagram is targeted with more than one, since Instagram has no
  // carousel support (see the isPhoto/platformPhotoUrls handling in
  // ScheduleCard's handleSubmit, which already silently sends just the
  // first photo — this warning tells the user that before they submit).
  // Optional/undefined in BulkVideoCard, same reasoning as instagramConnected.
  photoCount?: number;
  // openspec/changes/tiktok-photo-post (Decision 6, revised): content type is
  // derived from what was actually dropped, never chosen here — this only
  // reads it, to gray out YouTube (no photo-post support) when it's "photo".
  contentType: VideoItem["contentType"];
  // Measured video duration, used to render TikTok's max_video_post_duration_sec
  // warning inside the TikTok section (gating still happens in the caller).
  videoDurationSec: number | null;
  // Format is optional here: single-mode ScheduleCard renders it inside the
  // YouTube section for one contiguous block of YouTube settings; bulk mode's
  // compact card keeps its own Format toggle next to the thumbnail instead
  // (different layout, not part of this settings block) and omits these.
  format?: VideoFormat;
  onFormatChange?: (next: VideoFormat) => void;
  shortWarn?: string | null;
  // Which fields to actually flag as errors right now — computed via
  // getMissingFields, but only passed non-empty once the user has attempted
  // to schedule (see ScheduleCard/BulkVideoCard's showErrors state). Always
  // enabled Schedule button + anchor-and-flag-on-click, not silently
  // disabled — a grilled decision, see CONTEXT.md.
  errorFields?: MissingField[];
  idPrefix?: string;
  // Platform availability (see CONTEXT.md) — a coming-soon platform still
  // renders here (per the grilled decision to reuse the sidebar's Soon-badge
  // pattern) but disabled, unless the caller is an admin (Admin preview).
  platformAvailability: { platforms: Record<Platform, boolean>; canBypass: Record<Platform, boolean> };
}) {
  const { status } = useCurrentUser();
  const discloseOpen = tiktokDiscloseOpen;
  const isSelfOnly = tiktokPrivacyLevel === "SELF_ONLY";
  const isPhoto = contentType === "photo";
  const hasYoutube = !isPhoto && platforms.includes("youtube");
  const hasTiktok = platforms.includes("tiktok");
  const hasInstagram = platforms.includes("instagram");
  const youtubeUsable = isPlatformUsable(platformAvailability.platforms.youtube, platformAvailability.canBypass.youtube);
  const tiktokUsable = isPlatformUsable(platformAvailability.platforms.tiktok, platformAvailability.canBypass.tiktok);
  const instagramUsable = isPlatformUsable(platformAvailability.platforms.instagram, platformAvailability.canBypass.instagram);
  // Bulk mode never wires Instagram at all yet (instagramConnected stays
  // undefined there — see the prop's own comment) — a coming-soon lock icon
  // would be misleading there since Instagram isn't a selectable option in
  // bulk mode regardless of availability. Single mode always passes an
  // explicit boolean, so this only actually gates in bulk mode.
  const instagramSupported = instagramConnected !== undefined;
  const youtubeBadge = platformBadge(platformAvailability.platforms.youtube, platformAvailability.canBypass.youtube);
  const tiktokBadge = platformBadge(platformAvailability.platforms.tiktok, platformAvailability.canBypass.tiktok);
  const instagramBadge = platformBadge(platformAvailability.platforms.instagram, platformAvailability.canBypass.instagram);

  // When exactly one platform is selectable at all (today: TikTok, once
  // YouTube/Instagram are coming-soon and/or not yet connected), there's no
  // real choice to make — auto-select it and skip the checkbox chooser
  // entirely (a grilled decision after live feedback that a permanently-
  // checked, non-interactive checkbox read as confusing). Matches each
  // checkbox's own render condition below exactly.
  const onlyPlatform = soleSelectablePlatform({
    youtube: youtubeUsable && !isPhoto,
    tiktok: tiktokConnected && tiktokUsable,
    instagram: instagramConnected && instagramUsable,
  });

  // Actually select it in state, not just visually — the submit/validation
  // path reads `platforms`, not this render-time computation. Depends only
  // on `onlyPlatform` (not `platforms`/`onChange`) so it fires once when the
  // sole option first becomes known, not on every keystroke elsewhere on
  // the card.
  useEffect(() => {
    if (onlyPlatform && (platforms.length !== 1 || platforms[0] !== onlyPlatform)) {
      onChange({ platforms: [onlyPlatform] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyPlatform]);

  // Unchecking a platform also clears its stale result — otherwise re-checking
  // it later could be silently skipped on the next submit as "already succeeded".
  const toggleYoutube = (checked: boolean) => {
    onChange({
      platforms: checked ? [...platforms, "youtube"] : platforms.filter((p) => p !== "youtube"),
      platformResults: checked ? platformResults : { ...platformResults, youtube: undefined },
    });
  };
  // No Instagram-specific fields to clear on uncheck (unlike TikTok) — this
  // step is selection only, per openspec/changes/connect-instagram Phase 4
  // task 9.1-9.2. Content-type gating and carousel limits are a later task.
  const toggleInstagram = (checked: boolean) => {
    onChange({
      platforms: checked ? [...platforms, "instagram"] : platforms.filter((p) => p !== "instagram"),
      platformResults: checked ? platformResults : { ...platformResults, instagram: undefined },
    });
  };
  const toggleTiktok = (checked: boolean) => {
    onChange(
      checked
        ? { platforms: [...platforms, "tiktok"] }
        : {
            platforms: platforms.filter((p) => p !== "tiktok"),
            tiktokPrivacyLevel: null,
            tiktokBrandOrganicToggle: false,
            tiktokBrandContentToggle: false,
            tiktokDiscloseOpen: false,
            tiktokAllowComment: false,
            tiktokAllowDuet: false,
            tiktokAllowStitch: false,
            tiktokConsentChecked: false,
            platformResults: { ...platformResults, tiktok: undefined },
          },
    );
  };

  return (
    <div className="space-y-4">
      {/* Which account is actually connected per platform, and a one-click
          way to switch/reconnect — ConnectionStatusBadge already exists
          (used on the Calendar page) and fetches its own status
          independently, so this needs no new props or plumbing here. Shown
          above the checkboxes themselves so it reads as "here's who you're
          posting as," not a setting buried elsewhere. */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-text-secondary">
          Connected accounts
        </label>
        <div className="flex flex-wrap gap-2">
          <ConnectionStatusBadge platform="youtube" />
          <ConnectionStatusBadge platform="tiktok" />
          <ConnectionStatusBadge platform="instagram" />
        </div>
      </div>
      <div id={`${idPrefix}post-platforms`}>
        <label className="mb-1.5 block text-xs font-medium text-text-secondary">
          Platform {!onlyPlatform && <span className="text-error" aria-hidden>*</span>}
        </label>
        {onlyPlatform ? (
          // Exactly one platform is selectable — nothing to choose between,
          // so no checkbox at all (a grilled decision: a permanently-checked,
          // non-interactive checkbox reads as confusing, see CONTEXT.md).
          <div className="flex items-center gap-2 rounded-radius-xl border border-white/30 bg-white/10 px-3.5 py-2.5 text-sm text-N900">
            {onlyPlatform === "youtube" && <YoutubeIcon className="h-4 w-4 text-red-400" />}
            {onlyPlatform === "tiktok" && <Music2 className="h-4 w-4 text-pink-400" />}
            {onlyPlatform === "instagram" && <InstagramIcon className="h-4 w-4 text-fuchsia-400" />}
            {PLATFORM_LABELS[onlyPlatform]}
          </div>
        ) : (
        <div className="flex flex-wrap gap-2">
          {/* Coming-soon platforms don't render here at all for a regular
              user (a grilled reversal of the earlier "visible but locked"
              design, after seeing it live read as confusing/misleading —
              see CONTEXT.md) — an admin or preview-allowlisted account still
              sees it, enabled, with a "Preview" badge. */}
          {youtubeUsable && (
            <label
              title={isPhoto ? "YouTube doesn't support photo posts" : undefined}
              className={`flex items-center gap-2 rounded-radius-xl border px-3.5 py-2.5 text-sm transition-colors ${
                isPhoto
                  ? "cursor-not-allowed border-white/10 bg-white/5 text-text-disabled"
                  : hasYoutube
                    ? "cursor-pointer border-white/30 bg-white/10 text-N900"
                    : "cursor-pointer border-white/10 bg-white/10 text-text-secondary hover:border-white/20"
              }`}
            >
              <input
                type="checkbox"
                checked={hasYoutube}
                disabled={isPhoto}
                onChange={(e) => toggleYoutube(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/10 bg-white/10 text-N900 focus:ring-white/30 disabled:cursor-not-allowed"
              />
              <YoutubeIcon className={`h-4 w-4 ${isPhoto ? "text-text-disabled" : "text-red-400"}`} />
              YouTube
              {youtubeBadge !== "none" && <PlatformSoonBadge kind={youtubeBadge} />}
            </label>
          )}

          {tiktokConnected && tiktokUsable && (
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-radius-xl border px-3.5 py-2.5 text-sm transition-colors ${
                hasTiktok ? "border-white/30 bg-white/10 text-N900" : "border-white/10 bg-white/10 text-text-secondary hover:border-white/20"
              }`}
            >
              <input
                type="checkbox"
                checked={hasTiktok}
                onChange={(e) => toggleTiktok(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/10 bg-white/10 text-N900 focus:ring-white/30"
              />
              <Music2 className="h-4 w-4 text-pink-400" />
              TikTok
              {tiktokBadge !== "none" && <PlatformSoonBadge kind={tiktokBadge} />}
            </label>
          )}

          {instagramConnected && instagramUsable && (
            <label
              className={`flex cursor-pointer items-center gap-2 rounded-radius-xl border px-3.5 py-2.5 text-sm transition-colors ${
                hasInstagram ? "border-white/30 bg-white/10 text-N900" : "border-white/10 bg-white/10 text-text-secondary hover:border-white/20"
              }`}
            >
              <input
                type="checkbox"
                checked={hasInstagram}
                onChange={(e) => toggleInstagram(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-white/10 bg-white/10 text-N900 focus:ring-white/30"
              />
              <InstagramIcon className="h-4 w-4 text-fuchsia-400" />
              Instagram
              {instagramBadge !== "none" && <PlatformSoonBadge kind={instagramBadge} />}
            </label>
          )}
        </div>
        )}
        {/* These hints only make sense when there's an actual choice to
            explain — moot once onlyPlatform has already made the pick. */}
        {!onlyPlatform && !tiktokConnected && tiktokUsable && status === "authenticated" && (
          <p className="mt-1 text-xs text-text-disabled">Connect TikTok in Settings to publish there too.</p>
        )}
        {!onlyPlatform && instagramSupported && !instagramConnected && instagramUsable && status === "authenticated" && (
          <p className="mt-1 text-xs text-text-disabled">Connect Instagram in Settings to publish there too.</p>
        )}
        {!onlyPlatform && isPhoto && (
          <p className="mt-1 text-xs text-text-disabled">YouTube doesn&apos;t support photo posts.</p>
        )}
        {/* Non-blocking — Instagram now posts a real carousel too (grilled
            decision, see CONTEXT.md), just capped lower than TikTok's 35.
            Matches ScheduleCard's own platformPhotoUrls.slice(0, 10). */}
        {hasInstagram && isPhoto && (photoCount ?? 0) > INSTAGRAM_CAROUSEL_MAX_ITEMS && (
          <p className="mt-1 text-xs text-warning">
            Instagram carousels support up to {INSTAGRAM_CAROUSEL_MAX_ITEMS} photos — additional photos won&apos;t be included.
          </p>
        )}
        {!onlyPlatform && platforms.length === 0 && (
          <p className="mt-1 text-xs text-warning">Select at least one platform.</p>
        )}
        {errorFields.includes("alreadyPosted") && (
          <p className="mt-1 text-xs text-error">{MISSING_FIELD_MESSAGES.alreadyPosted}</p>
        )}
      </div>

      {/* Every YouTube-only setting lives in this one block — never split
          across the card so it doesn't read as interleaved with TikTok's. */}
      {hasYoutube && (
        <div className="space-y-3 rounded-radius-xl border border-white/10 bg-white/5 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-N900">
            <YoutubeIcon className="h-3.5 w-3.5 text-red-400" />
            YouTube
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-text-secondary">Privacy</label>
            <select
              value={youtubePrivacyStatus}
              onChange={(e) => onChange({ youtubePrivacyStatus: e.target.value as VideoItem["youtubePrivacyStatus"] })}
              className="w-full rounded-radius-xl border border-white/10 bg-white/10 px-3.5 py-2.5 text-sm text-text-primary transition-colors focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/30"
            >
              {(Object.keys(YOUTUBE_PRIVACY_LABELS) as Array<keyof typeof YOUTUBE_PRIVACY_LABELS>).map((opt) => (
                <option key={opt} value={opt}>
                  {YOUTUBE_PRIVACY_LABELS[opt]}
                </option>
              ))}
            </select>
          </div>

          {format && onFormatChange && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-text-secondary">Format</label>
              <FormatToggle value={format} onChange={onFormatChange} />
              <p className="mt-1 text-xs text-text-disabled">
                {format === "short"
                  ? "Vertical, ≤ 3 min · publishes as a YouTube Short (#Shorts added)"
                  : "Any aspect ratio or length · publishes as a regular video"}
              </p>
              {shortWarn && (
                <div role="alert" className="mt-2 flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3">
                  <AlertCircle className="mt-px h-4 w-4 shrink-0 text-warning" />
                  <p className="text-xs text-warning">{shortWarn}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Every TikTok-only setting lives in this one block, same reasoning. */}
      {hasTiktok && (
        <div id={`${idPrefix}tiktok-fields`} className="space-y-3 rounded-radius-xl border border-white/10 bg-white/5 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-N900">
            <Music2 className="h-3.5 w-3.5 text-pink-400" />
            TikTok
            {tiktokCreatorInfo.creatorNickname && (
              <span className="font-normal text-text-secondary">
                · posting as {tiktokCreatorInfo.creatorNickname}
              </span>
            )}
          </div>

          {tiktokCreatorInfo.postingBlocked ||
          tiktokCreatorInfo.httpKind === "reconnect" ||
          tiktokCreatorInfo.httpKind === "unavailable" ? (
            <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-error/30 bg-error/10 px-3.5 py-3">
              <AlertCircle className="mt-px h-4 w-4 shrink-0 text-error" />
              <p className="text-xs text-error">
                {tiktokCreatorInfo.httpKind === "reconnect"
                  ? "TikTok needs to be reconnected before you can schedule."
                  : tiktokCreatorInfo.httpKind === "unavailable"
                    ? "Couldn't load TikTok creator info. Try again in a moment."
                    : (tiktokCreatorInfo.blockedReason ?? "This TikTok account can't publish right now.")}
              </p>
            </div>
          ) : (
            <>
              {tiktokCreatorInfo.rateLimited && (
                <div role="status" className="flex items-start gap-2.5 rounded-lg border border-info/30 bg-info/10 px-3.5 py-3">
                  <AlertCircle className="mt-px h-4 w-4 shrink-0 text-info" />
                  <p className="text-xs text-info">
                    {tiktokCreatorInfo.rateLimitedReason ??
                      "TikTok's daily post cap is reached right now — you can still schedule; this won't affect a future-dated post."}
                  </p>
                </div>
              )}

              <div id={`${idPrefix}tiktok-privacy`}>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                  Privacy <span className="text-error" aria-hidden>*</span>
                </label>
                <select
                  value={tiktokPrivacyLevel ?? ""}
                  onChange={(e) => {
                    const next = e.target.value;
                    // Leaving SELF_ONLY invalidates a branded-content disclosure.
                    onChange(
                      next === "SELF_ONLY"
                        ? { tiktokPrivacyLevel: next, tiktokBrandContentToggle: false }
                        : { tiktokPrivacyLevel: next },
                    );
                  }}
                  className={`w-full rounded-radius-xl border bg-white/10 px-3.5 py-2.5 text-sm text-text-primary transition-colors focus:outline-none focus:ring-1 ${
                    errorFields.includes("tiktokPrivacy")
                      ? "border-error focus:border-error focus:ring-error"
                      : "border-white/10 focus:border-white/40 focus:ring-white/30"
                  }`}
                >
                  <option value="" disabled>
                    {tiktokCreatorInfoPrivacyPlaceholder({
                      optionCount: tiktokCreatorInfo.privacyLevelOptions.length,
                      httpKind: tiktokCreatorInfo.httpKind,
                    })}
                  </option>
                  {tiktokCreatorInfo.privacyLevelOptions.map((opt) => (
                    <option key={opt} value={opt}>
                      {TIKTOK_PRIVACY_LABELS[opt] ?? opt}
                    </option>
                  ))}
                </select>
                {errorFields.includes("tiktokPrivacy") && (
                  <p className="mt-1 text-xs text-error">{MISSING_FIELD_MESSAGES.tiktokPrivacy}</p>
                )}
              </div>

              {/* TikTok's own max_video_post_duration_sec check — blocking,
                  unlike the advisory YouTube Shorts warning above. */}
              {videoDurationSec != null &&
                tiktokCreatorInfo.maxVideoPostDurationSec > 0 &&
                videoDurationSec > tiktokCreatorInfo.maxVideoPostDurationSec && (
                  <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-error/30 bg-error/10 px-3.5 py-3">
                    <AlertCircle className="mt-px h-4 w-4 shrink-0 text-error" />
                    <p className="text-xs text-error">
                      This video is {Math.round(videoDurationSec)}s long, longer than the{" "}
                      {tiktokCreatorInfo.maxVideoPostDurationSec}s TikTok allows for this account.
                    </p>
                  </div>
                )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-text-secondary">Interactions</label>
                <div className="space-y-1.5">
                  <div>
                    <label
                      className={`flex items-center gap-2 text-xs ${tiktokCreatorInfo.commentDisabled ? "cursor-not-allowed text-text-disabled" : "cursor-pointer text-text-secondary"}`}
                    >
                      <input
                        type="checkbox"
                        checked={tiktokAllowComment && !tiktokCreatorInfo.commentDisabled}
                        disabled={tiktokCreatorInfo.commentDisabled}
                        onChange={(e) => onChange({ tiktokAllowComment: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border-white/10 bg-white/10 text-N900 focus:ring-white/30 disabled:cursor-not-allowed"
                      />
                      Allow Comment
                    </label>
                    {tiktokCreatorInfo.commentDisabled && (
                      <p className="mt-0.5 pl-5.5 text-[11px] text-text-disabled">
                        Comments are disabled for this account in the TikTok app.
                      </p>
                    )}
                  </div>

                  {/* TikTok's API has no field to pick a specific track —
                      only this on/off (see lib/tiktok.ts's initPhotoPost) —
                      so this is a real choice, not just informational: skip
                      TikTok's auto-picked music entirely, or let it add one
                      (still changeable afterward in the TikTok app either
                      way). Previously hardcoded true with no opt-out. */}
                  {isPhoto && (
                    <div>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={tiktokAutoAddMusic}
                          onChange={(e) => onChange({ tiktokAutoAddMusic: e.target.checked })}
                          className="h-3.5 w-3.5 rounded border-white/10 bg-white/10 text-N900 focus:ring-white/30"
                        />
                        Let TikTok add recommended music
                      </label>
                      <p className="mt-0.5 pl-5.5 text-[11px] text-text-disabled">
                        TikTok picks the song itself — there&apos;s no way to choose a specific track here or see the name in
                        advance, but you can always change it afterward in the TikTok app.
                      </p>
                    </div>
                  )}

                  {!isPhoto && (
                    <>
                      <div>
                        <label
                          className={`flex items-center gap-2 text-xs ${tiktokCreatorInfo.duetDisabled ? "cursor-not-allowed text-text-disabled" : "cursor-pointer text-text-secondary"}`}
                        >
                          <input
                            type="checkbox"
                            checked={tiktokAllowDuet && !tiktokCreatorInfo.duetDisabled}
                            disabled={tiktokCreatorInfo.duetDisabled}
                            onChange={(e) => onChange({ tiktokAllowDuet: e.target.checked })}
                            className="h-3.5 w-3.5 rounded border-white/10 bg-white/10 text-N900 focus:ring-white/30 disabled:cursor-not-allowed"
                          />
                          Allow Duet
                        </label>
                        {tiktokCreatorInfo.duetDisabled && (
                          <p className="mt-0.5 pl-5.5 text-[11px] text-text-disabled">
                            Duets are disabled for this account in the TikTok app.
                          </p>
                        )}
                      </div>
                      <div>
                        <label
                          className={`flex items-center gap-2 text-xs ${tiktokCreatorInfo.stitchDisabled ? "cursor-not-allowed text-text-disabled" : "cursor-pointer text-text-secondary"}`}
                        >
                          <input
                            type="checkbox"
                            checked={tiktokAllowStitch && !tiktokCreatorInfo.stitchDisabled}
                            disabled={tiktokCreatorInfo.stitchDisabled}
                            onChange={(e) => onChange({ tiktokAllowStitch: e.target.checked })}
                            className="h-3.5 w-3.5 rounded border-white/10 bg-white/10 text-N900 focus:ring-white/30 disabled:cursor-not-allowed"
                          />
                          Allow Stitch
                        </label>
                        {tiktokCreatorInfo.stitchDisabled && (
                          <p className="mt-0.5 pl-5.5 text-[11px] text-text-disabled">
                            Stitches are disabled for this account in the TikTok app.
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div>
                <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-text-secondary">
                  <input
                    type="checkbox"
                    checked={discloseOpen}
                    onChange={(e) => {
                      const open = e.target.checked;
                      onChange(
                        open
                          ? { tiktokDiscloseOpen: true }
                          : { tiktokDiscloseOpen: false, tiktokBrandOrganicToggle: false, tiktokBrandContentToggle: false },
                      );
                    }}
                    className="h-3.5 w-3.5 rounded border-white/10 bg-white/10 text-N900 focus:ring-white/30"
                  />
                  Disclose video content
                </label>

                {discloseOpen && (
                  <div className="mt-2 space-y-2 pl-5.5">
                    <div>
                      <label className="flex cursor-pointer items-center gap-2 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={tiktokBrandOrganicToggle}
                          onChange={(e) => onChange({ tiktokBrandOrganicToggle: e.target.checked })}
                          className="h-3.5 w-3.5 rounded border-white/10 bg-white/10 text-N900 focus:ring-white/30"
                        />
                        Your Brand
                      </label>
                      <p className="mt-0.5 text-[11px] text-text-disabled">
                        You&apos;re promoting yourself or your own business — labeled as &ldquo;Promotional
                        content&rdquo;.
                      </p>
                    </div>
                    <div>
                      <label
                        className={`flex items-center gap-2 text-xs ${isSelfOnly ? "cursor-not-allowed text-text-disabled" : "cursor-pointer text-text-secondary"}`}
                      >
                        <input
                          type="checkbox"
                          checked={tiktokBrandContentToggle}
                          disabled={isSelfOnly}
                          onChange={(e) => onChange({ tiktokBrandContentToggle: e.target.checked })}
                          className="h-3.5 w-3.5 rounded border-white/10 bg-white/10 text-N900 focus:ring-white/30 disabled:cursor-not-allowed"
                        />
                        Branded Content
                      </label>
                      <p className="mt-0.5 text-[11px] text-text-disabled">
                        You&apos;re promoting another brand or a third party — labeled as &ldquo;Paid
                        partnership&rdquo;.
                      </p>
                    </div>
                    {isSelfOnly && (
                      <p className="text-[11px] text-text-disabled">
                        Branded content must be public — unavailable while privacy is &ldquo;Only me&rdquo;.
                      </p>
                    )}
                    {!tiktokBrandOrganicToggle && !tiktokBrandContentToggle && (
                      <p role="alert" className="text-[11px] text-warning">
                        You need to indicate if your content promotes yourself, a third party, or both.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Instagram parity with TikTok's "posting as" line above — no other
          settings yet (no privacy level, no interaction toggles for
          Instagram in this app today), so this panel is deliberately just
          the identity line. YouTube gets no equivalent (decided against
          broadening its OAuth scope — see the connect-instagram Phase 4
          work earlier this session). */}
      {hasInstagram && (
        <div className="rounded-radius-xl border border-white/10 bg-white/5 p-3.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-N900">
            <InstagramIcon className="h-3.5 w-3.5 text-fuchsia-400" />
            Instagram
            {instagramUsername && (
              <span className="font-normal text-text-secondary">
                · posting as @{instagramUsername}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Schedule Card ────────────────────────────────────────────────────────────

interface ScheduleCardProps {
  videoUrl: string | null;
  storagePath: string | null;
  // Staged raw file not yet uploaded to Storage (upload is deferred until
  // "Schedule Post" is clicked — see handleFilesAdded/uploadStagedMedia).
  // Null for an item sourced from "Choose from Assets" (already hosted).
  file: File | null;
  caption: string;
  // Full reset (wipes the draft back to blank) — called only on full success,
  // never on partial/total failure, so a failed platform stays selected and
  // retryable instead of losing the user's entered data.
  onSuccess: () => void;
  // Refreshes the Recent Posts list without wiping the draft — called
  // whenever at least one platform's post was created this attempt, even on
  // a partial failure.
  onPostCreated: () => void;
  onToast: (toast: ToastState) => void;
  // Measured metadata — drives advisory (non-blocking) warnings
  videoDuration: number | null;
  videoAspect: { w: number; h: number } | null;
  // Publish format + override handler
  format: VideoFormat;
  onFormatChange: (next: VideoFormat) => void;
  // Lifted to page so DescriptionCard can read them for AI prompts
  title: string;
  tags: string;
  onTitleChange: (title: string) => void;
  onTagsChange: (tags: string) => void;
  // Platform(s) + TikTok privacy/disclosure (lifted to page, patched generically)
  platforms: VideoItem["platforms"];
  platformResults: VideoItem["platformResults"];
  youtubePrivacyStatus: VideoItem["youtubePrivacyStatus"];
  tiktokPrivacyLevel: string | null;
  tiktokBrandOrganicToggle: boolean;
  tiktokBrandContentToggle: boolean;
  tiktokDiscloseOpen: boolean;
  tiktokAllowComment: boolean;
  tiktokAllowDuet: boolean;
  tiktokAllowStitch: boolean;
  tiktokAutoAddMusic: boolean;
  tiktokConsentChecked: boolean;
  onPlatformPatch: (patch: PlatformPatch) => void;
  // Persists the result of the deferred upload (see handleSubmit) into the
  // parent's item state — a distinct, narrower prop from onPlatformPatch so
  // this component doesn't need a fully generic Partial<VideoItem> setter.
  onMediaUploaded: (
    patch: Partial<Pick<VideoItem, "videoUrl" | "storagePath" | "photoUrls" | "file" | "uploadStatus">>,
  ) => void;
  tiktokConnected: boolean;
  tiktokCreatorInfo: TikTokCreatorInfoState;
  instagramConnected?: boolean;
  instagramUsername?: string | null;
  // TikTok photo posts (openspec/changes/tiktok-photo-post) — read-only here.
  // contentType is derived from what was dropped/picked (UploadCard + the
  // top-level handlers), never set from within ScheduleCard itself.
  contentType: VideoItem["contentType"];
  photoUrls: string[];
  platformAvailability: { platforms: Record<Platform, boolean>; canBypass: Record<Platform, boolean> };
}

function ScheduleCard({
  videoUrl,
  storagePath,
  file,
  caption,
  onSuccess,
  onPostCreated,
  onToast,
  videoDuration,
  videoAspect,
  format,
  onFormatChange,
  title,
  tags,
  onTitleChange,
  onTagsChange,
  platforms,
  platformResults,
  youtubePrivacyStatus,
  tiktokPrivacyLevel,
  tiktokBrandOrganicToggle,
  tiktokBrandContentToggle,
  tiktokDiscloseOpen,
  tiktokAllowComment,
  tiktokAllowDuet,
  tiktokAllowStitch,
  tiktokAutoAddMusic,
  tiktokConsentChecked,
  onPlatformPatch,
  onMediaUploaded,
  tiktokConnected,
  tiktokCreatorInfo,
  instagramConnected,
  instagramUsername,
  contentType,
  photoUrls,
  platformAvailability,
}: ScheduleCardProps) {
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState<ScheduleForm>(() => nextScheduleSlot());
  const [submitting, setSubmitting] = useState(false);
  // Distinct from `submitting` only for button copy — the upload (deferred
  // until this click) happens before the actual schedule POST, and a large
  // video can take a few seconds, so "Uploading…" vs "Scheduling…" avoids it
  // looking frozen.
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [confirmEmptyCaption, setConfirmEmptyCaption] = useState(false);
  // Schedule Post stays clickable even when the form is incomplete — a
  // grilled decision (see CONTEXT.md's Platform availability neighbors):
  // clicking while incomplete anchors to and flags every missing field at
  // once, instead of the button silently disabling with a single generic
  // hint. showErrors gates whether missingFields renders as visible errors.
  const [showErrors, setShowErrors] = useState(false);

  // TikTok-only gates — each is vacuously true when TikTok isn't a selected
  // platform, so they never affect a YouTube-only schedule.
  const tiktokTargeted = platforms.includes("tiktok");
  const tiktokNotBlocked = !tiktokTargeted || !tiktokCreatorInfoBlocksSchedule(tiktokCreatorInfo);
  const tiktokDurationOk =
    !tiktokTargeted ||
    !videoDuration ||
    !tiktokCreatorInfo.maxVideoPostDurationSec ||
    videoDuration <= tiktokCreatorInfo.maxVideoPostDurationSec;
  // TikTok's own guideline: disable publish if the disclosure section is
  // open but neither "Your Brand" nor "Branded Content" is chosen.
  const tiktokDiscloseComplete =
    !tiktokTargeted || !tiktokDiscloseOpen || tiktokBrandOrganicToggle || tiktokBrandContentToggle;
  const tiktokConsentOk = !tiktokTargeted || tiktokConsentChecked;

  // Retry-safe: only submit platforms that haven't already succeeded on a
  // prior attempt (see openspec/changes/fix-schedule-retry-duplication).
  const pendingPlatforms = platforms.filter((p) => platformResults[p]?.status !== "success");
  // A staged raw file (not yet uploaded — upload is deferred until submit)
  // counts as "has media" too, alongside an already-resolved ref.
  const hasMedia = contentType === "photo" ? (photoUrls.length > 0 || !!file) : !!(storagePath || videoUrl || file);
  const missingFields = getMissingFields({
    hasMedia,
    title,
    date: form.date,
    time: form.time,
    platformCount: platforms.length,
    pendingPlatformCount: pendingPlatforms.length,
    targetsTikTok: tiktokTargeted,
    tiktokPrivacyLevel,
    tiktokNotBlocked,
    tiktokDurationOk,
    tiktokDiscloseComplete,
    tiktokConsentOk,
  });
  const errorFields = showErrors ? missingFields : [];

  const set = (key: keyof ScheduleForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleBestTime = () => setForm((prev) => ({ ...prev, ...bestTimeSlot() }));

  const resetForm = () => {
    setForm(nextScheduleSlot());
    onTitleChange("");
    onTagsChange("");
    setConfirmEmptyCaption(false);
  };

  const handleSubmit = async () => {
    if (missingFields.length > 0) {
      setShowErrors(true);
      scrollToFirstMissingField(missingFields);
      return;
    }
    setShowErrors(false);

    if (status !== "authenticated") {
      openSignInModal(undefined, { title, tags, caption });
      return;
    }

    // Soft, non-blocking warning: empty caption requires one confirming click
    if (!caption.trim() && !confirmEmptyCaption) {
      setConfirmEmptyCaption(true);
      return;
    }

    setSubmitting(true);

    // Upload the staged file now, if there is one — this is the point upload
    // was deferred to (see handleFilesAdded). Resolve local variables rather
    // than relying on the parent re-rendering with fresh props in time; also
    // persist the result via onPlatformPatch so a retry after a later
    // failure doesn't re-upload.
    let effectiveVideoUrl = videoUrl;
    let effectiveStoragePath = storagePath;
    let effectivePhotoUrls = photoUrls;

    if (file) {
      setUploadingMedia(true);
      try {
        const isPhotoFile = contentType === "photo";
        const uploaded = await signAndUploadFile(file, isPhotoFile ? "image" : "video");
        if (isPhotoFile) {
          // The staged file is always the cover (position 0) — it was the
          // first photo selected for this card, matching the previous
          // immediate-upload behavior.
          effectivePhotoUrls = [uploaded.storagePath, ...photoUrls];
          onMediaUploaded({ photoUrls: effectivePhotoUrls, file: null, uploadStatus: "done" });
        } else {
          effectiveVideoUrl = uploaded.url;
          effectiveStoragePath = uploaded.storagePath;
          onMediaUploaded({ videoUrl: uploaded.url, storagePath: uploaded.storagePath, file: null, uploadStatus: "done" });
        }
      } catch (err) {
        onToast({ type: "error", message: err instanceof Error ? err.message : "Upload failed. Please try again." });
        setUploadingMedia(false);
        setSubmitting(false);
        return;
      }
      setUploadingMedia(false);
    }

    try {
      const scheduled_time = new Date(`${form.date}T${form.time}:00`).toISOString();

      const results = await Promise.allSettled(
        pendingPlatforms.map(async (p) => {
          // Shorts get #Shorts appended to reinforce YouTube's classification.
          // YouTube-only — format/#Shorts is not a TikTok concept.
          const description = p === "youtube" && format === "short" ? withShortsTag(caption) : caption;

          // A TikTok or Instagram photo post sends photo_urls instead of
          // video_url — never both. YouTube always sends video_url (no
          // photo-post concept). Previously TikTok-only, which silently sent
          // an empty video_url for an Instagram photo post instead — Instagram
          // supports photo mode too, just without TikTok's carousel.
          const isPhoto = (p === "tiktok" || p === "instagram") && contentType === "photo";
          // Instagram carousel support (grilled decision — see CONTEXT.md):
          // same full photo set TikTok gets, bounded to Instagram's own
          // lower max (10, vs TikTok's 35 — see lib/instagram.ts's
          // INSTAGRAM_CAROUSEL_MAX_ITEMS, the source of truth for this
          // number) rather than TikTok's own, higher limit. Extra photos
          // are dropped here rather than triggering the server's 400 — the
          // warning below tells the user this before they ever submit.
          const platformPhotoUrls = p === "instagram" ? effectivePhotoUrls.slice(0, INSTAGRAM_CAROUSEL_MAX_ITEMS) : effectivePhotoUrls;

          const res = await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(isPhoto
                ? { photo_urls: platformPhotoUrls }
                : effectiveStoragePath
                  ? { storage_path: effectiveStoragePath }
                  : { video_url: effectiveVideoUrl }),
              title: title.trim(),
              description,
              tags,
              scheduled_time,
              platform: p,
              ...(p === "youtube" ? { format, youtube_privacy_status: youtubePrivacyStatus } : {}),
              ...(p === "tiktok"
                ? {
                    tiktok_privacy_level: tiktokPrivacyLevel,
                    tiktok_brand_organic_toggle: tiktokBrandOrganicToggle,
                    tiktok_brand_content_toggle: tiktokBrandContentToggle,
                    tiktok_disable_comment: !tiktokAllowComment,
                    // Duet/Stitch are not a photo-post concept — forced
                    // disabled here regardless of the stored toggle state,
                    // matching the server-side derivation in
                    // app/api/posts/route.ts and lib/tiktok.ts's
                    // initPhotoPost hardcoding them too.
                    tiktok_disable_duet: isPhoto ? true : !tiktokAllowDuet,
                    tiktok_disable_stitch: isPhoto ? true : !tiktokAllowStitch,
                    ...(isPhoto ? { tiktok_auto_add_music: tiktokAutoAddMusic } : {}),
                  }
                : {}),
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Failed to schedule post.");
          return p;
        }),
      );

      // Merge this attempt's outcomes into any results carried over from a
      // prior partial failure, so the summary below reflects the whole set.
      const newResults: Partial<Record<"youtube" | "tiktok" | "instagram", PlatformResult>> = {};
      results.forEach((r, i) => {
        const p = pendingPlatforms[i];
        newResults[p] =
          r.status === "fulfilled"
            ? { status: "success" }
            : { status: "failed", error: r.reason instanceof Error ? r.reason.message : "failed" };
      });
      const mergedResults = { ...platformResults, ...newResults };
      onPlatformPatch({ platformResults: mergedResults });

      const succeeded = platforms.filter((p) => mergedResults[p]?.status === "success").map((p) => PLATFORM_LABELS[p]);
      const failed = platforms
        .filter((p) => mergedResults[p]?.status === "failed")
        .map((p) => `${PLATFORM_LABELS[p]}: ${mergedResults[p]?.error ?? "failed"}`);

      if (failed.length === 0) {
        onToast({
          type: "success",
          message: succeeded.length > 1 ? `✓ Scheduled to ${succeeded.join(" & ")}!` : "✓ Post scheduled successfully!",
        });
        // Full success — clear the carried-over results too, so the next,
        // unrelated post doesn't inherit stale "already succeeded" markers.
        onPlatformPatch({ platformResults: {} });
        resetForm();
        onSuccess();
      } else {
        if (succeeded.length > 0) {
          onToast({ type: "error", message: `Scheduled to ${succeeded.join(", ")}. Failed: ${failed.join("; ")}` });
          // At least one post was created — refresh the list, but keep the
          // draft (title/platforms/etc) intact so the failed platform stays
          // selected and retryable instead of the user losing their work.
          onPostCreated();
        } else {
          onToast({ type: "error", message: failed.join("; ") });
        }
      }
    } finally {
      setSubmitting(false);
    }
  };

  // Advisory (non-blocking) warnings for Shorts only.
  const shortWarn = formatWarning(format, videoDuration, videoAspect);
  const bestTime = bestTimeSlot();

  return (
    <Card className="sticky top-20">
      <CardHeader title="Schedule Post" icon={<Calendar className="h-4 w-4" />} />

      <div className="space-y-5 p-5">
        {/* Platform */}
        <PlatformFields
          platforms={platforms}
          platformResults={platformResults}
          youtubePrivacyStatus={youtubePrivacyStatus}
          tiktokPrivacyLevel={tiktokPrivacyLevel}
          tiktokBrandOrganicToggle={tiktokBrandOrganicToggle}
          tiktokBrandContentToggle={tiktokBrandContentToggle}
          tiktokDiscloseOpen={tiktokDiscloseOpen}
          tiktokAllowComment={tiktokAllowComment}
          tiktokAllowDuet={tiktokAllowDuet}
          tiktokAllowStitch={tiktokAllowStitch}
          tiktokAutoAddMusic={tiktokAutoAddMusic}
          onChange={onPlatformPatch}
          tiktokConnected={tiktokConnected}
          tiktokCreatorInfo={tiktokCreatorInfo}
          instagramConnected={instagramConnected}
          instagramUsername={instagramUsername}
          photoCount={photoUrls.length}
          contentType={contentType}
          videoDurationSec={videoDuration}
          format={format}
          onFormatChange={onFormatChange}
          shortWarn={shortWarn}
          errorFields={errorFields}
          platformAvailability={platformAvailability}
        />

        {errorFields.includes("media") && (
          <p className="-mt-3 text-xs text-error">{MISSING_FIELD_MESSAGES.media} in the Upload Media card.</p>
        )}

        {/* Title */}
        <div>
          <label htmlFor="post-title" className="mb-1.5 block text-xs font-medium text-text-secondary">
            Title <span className="text-error" aria-hidden>*</span>
          </label>
          <input
            id="post-title"
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="My awesome video title"
            className={`w-full rounded-radius-xl border bg-white/10 px-3.5 py-2.5 text-sm text-text-primary placeholder-text-disabled transition-colors focus:outline-none focus:ring-1 ${
              errorFields.includes("title")
                ? "border-error focus:border-error focus:ring-error"
                : "border-white/10 focus:border-white/40 focus:ring-white/30"
            }`}
          />
          {errorFields.includes("title") && (
            <p className="mt-1 text-xs text-error">{MISSING_FIELD_MESSAGES.title}</p>
          )}
        </div>

        {/* Tags */}
        <div>
          <label htmlFor="post-tags" className="mb-1.5 flex items-center gap-1 text-xs font-medium text-text-secondary">
            Tags
            <InfoTooltip text={TAGS_TOOLTIP} />
          </label>
          <div className="relative">
            <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-disabled" />
            <input
              id="post-tags"
              type="text"
              value={tags}
              onChange={(e) => onTagsChange(e.target.value)}
              placeholder="tutorial, automation, content"
              className="w-full rounded-radius-xl border border-white/10 bg-white/10 py-2.5 pl-9 pr-3.5 text-sm text-text-primary placeholder-text-disabled transition-colors focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/30"
            />
          </div>
          <p className="mt-1 text-xs text-text-disabled">Comma-separated</p>
        </div>

        {/* Date & Time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="schedule-date" className="mb-1.5 block text-xs font-medium text-text-secondary">
              <Calendar className="mr-1 inline h-3 w-3" />
              Date <span className="text-error" aria-hidden>*</span>
            </label>
            <input id="schedule-date" type="date" value={form.date} min={today} onChange={set("date")}
              className={`w-full rounded-radius-xl border bg-white/10 px-3 py-2.5 text-sm text-text-primary transition-colors focus:outline-none focus:ring-1 [color-scheme:dark] ${
                errorFields.includes("date") ? "border-error focus:border-error focus:ring-error" : "border-white/10 focus:border-white/40 focus:ring-white/30"
              }`} />
            {errorFields.includes("date") && <p className="mt-1 text-xs text-error">{MISSING_FIELD_MESSAGES.date}</p>}
          </div>
          <div>
            <label htmlFor="schedule-time" className="mb-1.5 block text-xs font-medium text-text-secondary">
              <Clock className="mr-1 inline h-3 w-3" />
              Time <span className="text-error" aria-hidden>*</span>
            </label>
            <input id="schedule-time" type="time" value={form.time} onChange={set("time")}
              className={`w-full rounded-radius-xl border bg-white/10 px-3 py-2.5 text-sm text-text-primary transition-colors focus:outline-none focus:ring-1 [color-scheme:dark] ${
                errorFields.includes("time") ? "border-error focus:border-error focus:ring-error" : "border-white/10 focus:border-white/40 focus:ring-white/30"
              }`} />
            {errorFields.includes("time") && <p className="mt-1 text-xs text-error">{MISSING_FIELD_MESSAGES.time}</p>}
          </div>
        </div>

        {/* Best Time */}
        <button type="button" onClick={handleBestTime}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-radius-xl border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm font-medium text-warning transition-all duration-200 hover:border-warning/50 hover:bg-warning/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning">
          <Zap className="h-4 w-4" />
          Use Best Time · 6:00 PM {bestTime.isToday ? "today" : "tomorrow"}
        </button>

        <div className="border-t border-white/10 pt-1" />

        {/* Soft warning: empty caption — does not block, just confirms */}
        {confirmEmptyCaption && !caption.trim() && (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3">
            <AlertCircle className="mt-px h-4 w-4 shrink-0 text-warning" />
            <p className="text-xs text-warning">
              ⚠️ No caption added. Click “Schedule Post” again to publish without one,
              or write a caption above.
            </p>
          </div>
        )}

        {/* TikTok's required pre-publish declaration + express consent */}
        {tiktokTargeted && !tiktokCreatorInfoBlocksSchedule(tiktokCreatorInfo) && (
          <TikTokConsentDeclaration
            brandContentToggle={tiktokBrandContentToggle}
            checked={tiktokConsentChecked}
            onCheckedChange={(checked) => onPlatformPatch({ tiktokConsentChecked: checked })}
            showError={errorFields.includes("tiktokConsent")}
          />
        )}

        {/* Submit — always enabled; clicking while incomplete anchors to and
            flags every missing field at once instead of silently disabling. */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-radius-xl bg-bg-static-white px-4 py-3 text-sm font-semibold text-text-static-black shadow-lg shadow-N0/30 transition-all duration-200 hover:bg-N800 hover:shadow-N0/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {uploadingMedia
            ? <><RefreshCw className="h-4 w-4 animate-spin" />Uploading…</>
            : submitting
              ? <><RefreshCw className="h-4 w-4 animate-spin" />Scheduling…</>
              : <><Calendar className="h-4 w-4" />Schedule Post</>}
        </button>

        {errorFields.length > 0 && (
          <p className="text-center text-xs text-error">Fix the highlighted fields above to schedule.</p>
        )}
      </div>
    </Card>
  );
}

// ─── Recent Posts Card ────────────────────────────────────────────────────────

const STATUS_CFG = {
  scheduled:  { label: "Scheduled",  badge: "border-info/30 bg-info/10 text-info",       dot: "bg-info"   },
  overdue:    { label: "Overdue",    badge: "border-warning/30 bg-warning/10 text-warning",    dot: "bg-warning"  },
  retrying:   { label: "Retrying",   badge: "border-info/30 bg-info/10 text-info",       dot: "bg-info"   },
  publishing: { label: "Publishing", badge: "border-white/20 bg-white/10 text-text-secondary", dot: "bg-white/70" },
  published:  { label: "Published",  badge: "border-success/30 bg-success/10 text-success",     dot: "bg-success"  },
  failed:     { label: "Failed",     badge: "border-error/30 bg-error/10 text-error",           dot: "bg-error"    },
  canceled:   { label: "Canceled",   badge: "border-white/10 bg-white/10 text-text-disabled",              dot: "bg-N200"   },
  draft:      { label: "Draft",      badge: "border-white/10 bg-white/10 text-text-secondary",              dot: "bg-N400"   },
} as const;

interface RecentPostsCardProps {
  posts: Post[];
  loading: boolean;
  onRetry: (postId: string) => void;
}

function RecentPostsCard({ posts, loading, onRetry }: RecentPostsCardProps) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="text-text-secondary"><CalendarDays className="h-4 w-4" /></span>
          <h2 className="text-sm font-semibold text-N900">Your Recent Posts</h2>
        </div>
        <div className="flex items-center gap-3">
          {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-text-disabled" />}
          <Link
            href="/tools/scheduler/calendar"
            className="flex items-center gap-1.5 text-xs text-text-secondary transition-colors hover:text-N900"
          >
            View all in Calendar
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </div>

      <div className="divide-y divide-white/10">
        {posts.length === 0 && !loading && (
          <p className="px-5 py-6 text-center text-sm text-text-disabled">
            No posts yet. Schedule your first video above.
          </p>
        )}

        {posts.map((post) => {
          const display = derivePostDisplayStatus(post);
          const cfg = STATUS_CFG[display] ?? STATUS_CFG.draft;
          return (
            <div key={post.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${cfg.dot}`} />
              {post.platform === "tiktok" ? (
                <Music2 className="h-3.5 w-3.5 shrink-0 text-pink-400" aria-label="TikTok" />
              ) : (
                <YoutubeIcon className="h-3.5 w-3.5 shrink-0 text-red-400" aria-label="YouTube" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-N900">{post.title}</p>
                <p className="mt-0.5 text-xs text-text-disabled">{fmtScheduledTime(post.scheduled_time)}</p>
                {post.last_error && (post.status === "failed" || post.status === "scheduled") && (
                  <p
                    className={`mt-1 truncate text-xs ${post.status === "failed" ? "text-error/80" : "text-info/80"}`}
                    title={post.last_error}
                  >
                    {post.last_error}
                  </p>
                )}
              </div>
              <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.badge}`}>
                {cfg.label}
              </span>
              {/* Task 5.5: View on YouTube for published */}
              {post.status === "published" && post.youtube_video_id && (
                <a
                  href={`https://www.youtube.com/watch?v=${post.youtube_video_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="View on YouTube"
                  className="shrink-0 cursor-pointer rounded-md p-1.5 text-text-disabled transition-colors hover:bg-white/10 hover:text-red-400"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {/* Task 5.6: Retry for failed */}
              {post.status === "failed" && (
                <button
                  type="button"
                  onClick={() => onRetry(post.id)}
                  className="shrink-0 cursor-pointer rounded-radius-xl border border-white/10 px-2.5 py-1 text-xs text-text-secondary transition-colors hover:border-white/20 hover:text-N900"
                >
                  Retry
                </button>
              )}
            </div>
          );
        })}
      </div>

    </Card>
  );
}

// ─── Caption AI (shared logic) ────────────────────────────────────────────────

// Prompt 2 (Option A): reusable caption generation for bulk cards + the shared
// "same for all" box. Returns the caption so the caller decides where to store
// it (single item vs broadcast to all). DescriptionCard intentionally keeps its
// own copy of this logic untouched — reconciling the two is a deferred cleanup.
function useCaptionAI() {
  const [busy, setBusy] = useState<"generate" | "polish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null = nothing to show; true/false = result of the last Generate
  const [lastUsedTranscript, setLastUsedTranscript] = useState<boolean | null>(null);
  // Richer than the boolean: distinguishes a genuinely silent video ("no_audio")
  // from a failed extraction/transcription ("failed") so the UI can show an
  // accurate, retryable message instead of falsely claiming "no audio".
  const [lastTranscriptStatus, setLastTranscriptStatus] = useState<
    "ok" | "no_audio" | "failed" | null
  >(null);

  const resetWarning = useCallback(() => {
    setLastUsedTranscript(null);
    setLastTranscriptStatus(null);
  }, []);
  const clearError = useCallback(() => setError(null), []);

  const generate = useCallback(
    async (input: {
      title: string;
      tags: string;
      videoUrl: string | null;
      storagePath?: string | null;
      // Cover photo of a photo post — mutually exclusive with videoUrl/
      // storagePath above. The API already supports vision-based captioning
      // from this field (see app/api/generate-caption/route.ts); this was the
      // one piece that never sent it.
      photoStoragePath?: string | null;
      format?: VideoFormat;
    }): Promise<string> => {
      setBusy("generate");
      setError(null);
      setLastUsedTranscript(null);
      setLastTranscriptStatus(null);
      try {
        const res = await fetch("/api/generate-caption", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            description: "",
            title: input.title,
            tags: input.tags,
            videoUrl: input.videoUrl ?? undefined,
            storage_path: input.storagePath ?? undefined,
            photo_storage_path: input.photoStoragePath ?? undefined,
            format: input.format ?? "short",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
        setLastUsedTranscript(data.usedTranscript === true);
        setLastTranscriptStatus(
          data.transcriptStatus === "ok" ||
            data.transcriptStatus === "no_audio" ||
            data.transcriptStatus === "failed"
            ? data.transcriptStatus
            : null,
        );
        return data.caption as string;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
        throw err;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  // General mode: one shared caption from all cards' title+tags, no audio.
  // Intentionally leaves `lastUsedTranscript` at null so the "no audio detected"
  // warning never shows — there is no transcript in this flow by design.
  const generateGeneral = useCallback(
    async (videos: { title: string; tags: string }[]): Promise<string> => {
      setBusy("generate");
      setError(null);
      setLastUsedTranscript(null);
      setLastTranscriptStatus(null);
      try {
        const res = await fetch("/api/generate-caption", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: "general", videos }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
        return data.caption as string;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong.");
        throw err;
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const polish = useCallback(async (existingCaption: string): Promise<string> => {
    setBusy("polish");
    setError(null);
    setLastUsedTranscript(null);
    setLastTranscriptStatus(null);
    try {
      const res = await fetch("/api/generate-caption", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "polish", existingCaption }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
      return data.caption as string;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      throw err;
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, error, lastUsedTranscript, lastTranscriptStatus, resetWarning, clearError, generate, generateGeneral, polish };
}

// Buttons + status + transcript warning + error, driven by a useCaptionAI() instance.
// The textarea lives in the parent (per-card or shared box).
interface CaptionControlsProps {
  ai: ReturnType<typeof useCaptionAI>;
  hasMedia: boolean;
  hasContent: boolean;
  hasTitle: boolean;
  generateLabel: string;
  onGenerate: () => void;
  onPolish: () => void;
  // Hint shown when there's nothing to generate from yet. `null` hides it
  // (e.g. the shared box renders its own helper text instead).
  emptyHint?: string | null;
  // Busy state the caller manages itself — e.g. uploading a staged file
  // (upload is deferred until Schedule) before the AI call can even start.
  // ORed into ai.busy so the button stays disabled and shows a distinct
  // label throughout, not just once the actual generate request begins.
  extraBusy?: boolean;
  extraBusyLabel?: string;
}

function CaptionControls({
  ai,
  hasMedia,
  hasContent,
  hasTitle,
  generateLabel,
  onGenerate,
  onPolish,
  emptyHint = "Upload a video or photo first to generate an AI caption",
  extraBusy = false,
  extraBusyLabel = "Uploading…",
}: CaptionControlsProps) {
  const isBusy = ai.busy !== null || extraBusy;

  return (
    <div className="space-y-2">
      {hasContent && ai.lastTranscriptStatus === "failed" && (
        <p className="mt-1 text-xs text-warning">
          ⚠️ Couldn&apos;t read the audio this time — caption was generated from your title and tags.
          Try generating again.
        </p>
      )}

      {hasContent &&
        ai.lastTranscriptStatus === "no_audio" &&
        (hasTitle ? (
          <p className="mt-1 text-xs text-text-secondary">
            🎵 No audio detected — caption was generated from your title and tags.
          </p>
        ) : (
          <p className="mt-1 text-xs text-warning">
            ⚠️ No audio detected and no title added. Your caption may not be relevant — try adding a
            title and tags, then regenerate.
          </p>
        ))}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={isBusy || !hasMedia}
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-radius-xl bg-bg-static-white px-4 py-2.5 text-sm font-medium text-text-static-black transition-all duration-200 hover:bg-N800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {extraBusy ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              {extraBusyLabel}
            </>
          ) : ai.busy === "generate" ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin" />
              Generating…
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              {generateLabel}
            </>
          )}
        </button>

        {hasContent && (
          <button
            type="button"
            onClick={onPolish}
            disabled={isBusy}
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-radius-xl border border-white/25 bg-white/10 px-4 py-2.5 text-sm font-medium text-text-secondary transition-all duration-200 hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {ai.busy === "polish" ? (
              <>
                <RefreshCw className="h-4 w-4 animate-spin" />
                Polishing…
              </>
            ) : (
              <>✍️ Polish my caption</>
            )}
          </button>
        )}
      </div>

      {(ai.busy || extraBusy) && (
        <p className="text-center text-xs text-text-disabled">
          {extraBusy
            ? extraBusyLabel
            : ai.busy === "generate"
              ? "🎙️ Transcribing & writing…"
              : "✍️ Polishing your caption…"}
        </p>
      )}

      {!ai.busy && !hasContent && !hasMedia && emptyHint && (
        <p className="text-center text-xs text-text-disabled">{emptyHint}</p>
      )}

      {ai.error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-error/30 bg-error/10 px-3.5 py-3"
        >
          <AlertCircle className="mt-px h-4 w-4 shrink-0 text-error" />
          <div className="flex-1">
            <p className="text-xs font-medium text-error">Generation failed</p>
            <p className="mt-0.5 text-xs text-error/80">{ai.error}</p>
          </div>
          <button
            type="button"
            onClick={ai.clearError}
            aria-label="Dismiss"
            className="cursor-pointer text-error/60 hover:text-error"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Bulk Video Card ──────────────────────────────────────────────────────────

interface BulkVideoCardProps {
  item: VideoItem;
  index: number;
  captionMode: "individual" | "same";
  onUpdate: (patch: Partial<VideoItem>) => void;
  onRemove: () => void;
  tiktokConnected: boolean;
  tiktokCreatorInfo: TikTokCreatorInfoState;
  // Undo for handleFilesAdded's makeCarousel default — a carousel can land
  // inside a bulk batch just as easily as single mode (2+ photos merge
  // regardless of how many other items already exist), so this needs the
  // same escape hatch. Caller supplies item.id already bound.
  onSplitCarousel: () => void;
  // True once "Schedule All" has been clicked with this card still unready —
  // gates whether this card's own missing fields render as visible errors.
  // Set for ALL unready cards at once (a grilled decision — see CONTEXT.md),
  // not just the first, so one click surfaces the whole picture.
  showErrors: boolean;
  platformAvailability: { platforms: Record<Platform, boolean>; canBypass: Record<Platform, boolean> };
}

function BulkVideoCard({
  item,
  index,
  captionMode,
  onUpdate,
  onRemove,
  tiktokConnected,
  tiktokCreatorInfo,
  onSplitCarousel,
  showErrors,
  platformAvailability,
}: BulkVideoCardProps) {
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const today = new Date().toISOString().split("T")[0];
  const ai = useCaptionAI();
  const [uploadingForCaption, setUploadingForCaption] = useState(false);
  const tiktokTargeted = item.platforms.includes("tiktok");
  const tiktokNotBlocked = !tiktokTargeted || !tiktokCreatorInfoBlocksSchedule(tiktokCreatorInfo);
  const tiktokDurationOk =
    !tiktokTargeted ||
    !item.duration ||
    !tiktokCreatorInfo.maxVideoPostDurationSec ||
    item.duration <= tiktokCreatorInfo.maxVideoPostDurationSec;
  const tiktokDiscloseComplete =
    !tiktokTargeted || !item.tiktokDiscloseOpen || item.tiktokBrandOrganicToggle || item.tiktokBrandContentToggle;
  const tiktokConsentOk = !tiktokTargeted || item.tiktokConsentChecked;
  const hasMedia = item.contentType === "photo" ? (item.photoUrls.length > 0 || !!item.file) : !!(item.storagePath || item.videoUrl || item.file);
  const missingFields = getMissingFields({
    hasMedia,
    title: item.title,
    date: item.date,
    time: item.time,
    platformCount: item.platforms.length,
    // Bulk mode retries at the whole-card level (scheduleStatus), not per
    // platform like single mode's platformResults — never reports "already
    // posted" here.
    pendingPlatformCount: item.platforms.length,
    targetsTikTok: tiktokTargeted,
    tiktokPrivacyLevel: item.tiktokPrivacyLevel,
    tiktokNotBlocked,
    tiktokDurationOk,
    tiktokDiscloseComplete,
    tiktokConsentOk,
  });
  const errorFields = showErrors ? missingFields : [];
  // Choice-first "add more photos" flow (mirrors UploadCard's single-mode
  // photo picker) — collapsed to one button, only reveals the upload-vs-library
  // choice, then the relevant UI, once asked for.
  const [addPhotoMode, setAddPhotoMode] = useState<"closed" | "choice" | "library">("closed");
  const [addPhotoStatus, setAddPhotoStatus] = useState<"idle" | "uploading" | "error">("idle");
  const [addPhotoError, setAddPhotoError] = useState<string | null>(null);
  const newPhotoInputRef = useRef<HTMLInputElement>(null);

  const handleAddPhotoFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files ? Array.from(e.target.files) : [];
    if (newPhotoInputRef.current) newPhotoInputRef.current.value = "";
    if (selected.length === 0) return;

    const room = Math.max(0, 35 - item.photoUrls.length);
    const accepted = selected.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type)).slice(0, room);
    if (accepted.length === 0) return;

    setAddPhotoStatus("uploading");
    setAddPhotoError(null);
    const uploaded: string[] = [];
    let firstError: string | null = null;
    for (const f of accepted) {
      try {
        const { storagePath } = await signAndUploadFile(f, "image");
        uploaded.push(storagePath);
      } catch (err) {
        firstError = err instanceof Error ? err.message : "Upload failed.";
      }
    }
    if (uploaded.length > 0) onUpdate({ photoUrls: [...item.photoUrls, ...uploaded] });
    if (firstError) {
      setAddPhotoStatus("error");
      setAddPhotoError(firstError);
    } else {
      setAddPhotoStatus("idle");
    }
  };

  useEffect(() => {
    if (item.file) {
      const url = URL.createObjectURL(item.file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    if (item.storagePath) {
      let cancelled = false;
      fetchSignedUrl({ path: item.storagePath })
        .then((r) => { if (!cancelled) setPreviewUrl(r.url); })
        .catch(() => { if (!cancelled) setPreviewUrl(item.videoUrl); });
      return () => { cancelled = true; };
    }
    setPreviewUrl(item.videoUrl);
  }, [item.file, item.storagePath, item.videoUrl]);

  // Clear the transcript warning when this card's media changes
  useEffect(() => {
    ai.resetWarning();
  }, [item.videoUrl, item.storagePath, item.photoUrls, ai.resetWarning]);

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    const d = el.duration;
    const duration = isFinite(d) ? d : null;
    const aspect =
      el.videoWidth > 0 && el.videoHeight > 0
        ? { w: el.videoWidth, h: el.videoHeight }
        : null;
    const patch: Partial<VideoItem> = { duration, aspect };
    // Auto-suggest the format until the user manually overrides this card.
    if (!item.formatTouched) patch.format = suggestFormat(duration, aspect);
    onUpdate(patch);
  };

  const handleGenerate = async () => {
    try {
      const isPhoto = item.contentType === "photo";
      let effectiveVideoUrl = item.videoUrl;
      let effectiveStoragePath = item.storagePath;
      let effectivePhotoStoragePath = item.photoUrls[0] ?? null;

      // Upload is deferred until "Schedule All" is clicked — a just-picked
      // file has neither a hosted URL nor a photoUrls entry yet, only
      // `item.file`. Generate needs real bytes on a server the model can
      // fetch, so it uploads on demand here rather than staying disabled
      // for as long as the file sits unscheduled.
      if (item.file && !effectiveStoragePath && !effectiveVideoUrl && !effectivePhotoStoragePath) {
        setUploadingForCaption(true);
        try {
          const uploaded = await signAndUploadFile(item.file, isPhoto ? "image" : "video");
          if (isPhoto) {
            effectivePhotoStoragePath = uploaded.storagePath;
            onUpdate({ photoUrls: [uploaded.storagePath, ...item.photoUrls], file: null, uploadStatus: "done" });
          } else {
            effectiveVideoUrl = uploaded.url;
            effectiveStoragePath = uploaded.storagePath;
            onUpdate({ videoUrl: uploaded.url, storagePath: uploaded.storagePath, file: null, uploadStatus: "done" });
          }
        } finally {
          setUploadingForCaption(false);
        }
      }

      const caption = await ai.generate(
        isPhoto
          ? {
              title: item.title,
              tags: item.tags,
              videoUrl: null,
              storagePath: null,
              photoStoragePath: effectivePhotoStoragePath,
              format: item.format,
            }
          : {
              title: item.title,
              tags: item.tags,
              videoUrl: effectiveVideoUrl,
              storagePath: effectiveStoragePath,
              format: item.format,
            },
      );
      onUpdate({ caption });
    } catch {
      // error surfaced by the hook
    }
  };

  const handlePolish = async () => {
    try {
      const caption = await ai.polish(item.caption);
      onUpdate({ caption });
    } catch {
      // error surfaced by the hook
    }
  };

  const warn = formatWarning(item.format, item.duration, item.aspect);
  const frameClass = item.format === "short" ? "aspect-[9/16]" : "aspect-video";

  return (
    <Card id={`bulk-card-${item.id}`} className="p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* Left: compact thumbnail + meta */}
        <div className="w-full shrink-0 space-y-1.5 sm:w-36">
          {item.contentType === "photo" ? (
            item.photoUrls.length > 0 ? (
              <SchedulerPhotoImg
                src={item.photoUrls[0]}
                alt=""
                className={`w-full overflow-hidden rounded-lg border border-white/10 bg-N0 object-contain ${frameClass}`}
              />
            ) : previewUrl ? (
              // Staged raw photo, not yet uploaded (upload is deferred until
              // Schedule All is clicked) — preview straight from the local
              // File via the same previewUrl/URL.createObjectURL the video
              // branch below already uses.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt=""
                className={`w-full overflow-hidden rounded-lg border border-white/10 bg-N0 object-contain ${frameClass}`}
              />
            ) : (
              <div className={`flex w-full items-center justify-center rounded-lg border border-white/10 bg-white/5 ${frameClass}`}>
                <ImageIcon className="h-6 w-6 text-text-disabled" />
              </div>
            )
          ) : previewUrl ? (
            <div className={`w-full overflow-hidden rounded-lg border border-white/10 bg-N0 ${frameClass}`}>
              <video
                src={previewUrl}
                controls
                onLoadedMetadata={handleLoadedMetadata}
                className="h-full w-full object-contain"
              />
            </div>
          ) : (
            <div className={`flex w-full items-center justify-center rounded-lg border border-white/10 bg-white/5 ${frameClass}`}>
              <FileVideo className="h-6 w-6 text-text-disabled" />
            </div>
          )}

          {/* Format — YouTube-only concept (Short vs regular Video + #Shorts tag) */}
          {item.platforms.includes("youtube") && (
            <FormatToggle
              value={item.format}
              onChange={(next) => onUpdate({ format: next, formatTouched: true })}
              size="sm"
            />
          )}

          <div className="flex items-center justify-between gap-2 text-[11px] text-text-disabled">
            <span className="truncate">
              {item.contentType === "photo"
                ? `Photo post ${index + 1} (${item.photoUrls.length + (item.file ? 1 : 0)}/35)`
                : item.file?.name ?? `Video ${index + 1}`}
            </span>
            {item.contentType === "video" && item.duration !== null && (
              <span className={`shrink-0 ${warn ? "text-warning" : ""}`}>
                {fmtDuration(item.duration)}
              </span>
            )}
          </div>

          {item.contentType === "video" && item.platforms.includes("youtube") && warn && (
            <p className="flex items-start gap-1 text-[11px] text-warning">
              <AlertCircle className="mt-px h-3 w-3 shrink-0" />
              <span>{warn.replace(/^⚠️\s*/, "")}</span>
            </p>
          )}

          {item.uploadStatus === "error" && (
            <p className="text-[11px] text-error">{item.uploadError ?? "Upload failed."}</p>
          )}
        </div>

        {/* Right: fields */}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center justify-between gap-2">
            {/* Content-type-neutral heading — the caption under the thumbnail
                (below) is where video-vs-photo detail actually lives, so it
                isn't duplicated/contradicted here (see openspec/changes/
                tiktok-photo-post). */}
            <h2 className="text-sm font-semibold text-N900">Post {index + 1}</h2>
            <div className="flex items-center gap-2">
              {item.scheduleStatus === "scheduling" ? (
                <span className="flex items-center gap-1 text-xs text-text-secondary">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Scheduling…
                </span>
              ) : item.platforms.length > 1 && (item.scheduleStatus === "scheduled" || item.scheduleStatus === "failed") ? (
                // Per-platform breakdown — only when more than one platform is
                // selected. Single-platform cards keep the plain badge below,
                // unchanged (see openspec/changes/fix-schedule-retry-duplication).
                <div className="flex flex-col items-end gap-0.5">
                  {item.platforms.map((p) => {
                    const ok = item.platformResults[p]?.status === "success";
                    return (
                      <span
                        key={p}
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                          ok
                            ? "border-success/30 bg-success/10 text-success"
                            : "border-error/30 bg-error/10 text-error"
                        }`}
                      >
                        {PLATFORM_LABELS[p]} {ok ? "✓" : "✗"}
                      </span>
                    );
                  })}
                </div>
              ) : item.scheduleStatus === "scheduled" ? (
                <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[11px] font-medium text-success">
                  Scheduled ✅
                </span>
              ) : item.scheduleStatus === "failed" ? (
                <span className="rounded-full border border-error/30 bg-error/10 px-2 py-0.5 text-[11px] font-medium text-error">
                  Failed ❌
                </span>
              ) : (
                <>
                  {item.uploadStatus === "uploading" && (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-text-secondary" />
                  )}
                  {item.uploadStatus === "done" && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                  )}
                  {item.uploadStatus === "error" && (
                    <AlertCircle className="h-3.5 w-3.5 text-error" />
                  )}
                </>
              )}
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove post ${index + 1}`}
                className="cursor-pointer rounded-md p-1 text-text-disabled transition-colors hover:bg-white/10 hover:text-error"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {item.scheduleStatus === "failed" && item.scheduleError && (
            <p className="flex items-start gap-1 text-xs text-error">
              <AlertCircle className="mt-px h-3 w-3 shrink-0" />
              {item.scheduleError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                Title <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={item.title}
                onChange={(e) => onUpdate({ title: e.target.value })}
                placeholder="My awesome video title"
                className={`w-full rounded-radius-xl border bg-white/10 px-3 py-2 text-sm text-text-primary placeholder-text-disabled focus:outline-none focus:ring-1 ${
                  errorFields.includes("title") ? "border-error focus:border-error focus:ring-error" : "border-white/10 focus:border-white/40 focus:ring-white/30"
                }`}
              />
              {errorFields.includes("title") && <p className="mt-1 text-xs text-error">{MISSING_FIELD_MESSAGES.title}</p>}
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-text-secondary">
                Tags
                <InfoTooltip text={TAGS_TOOLTIP} />
              </label>
              <input
                type="text"
                value={item.tags}
                onChange={(e) => onUpdate({ tags: e.target.value })}
                placeholder="tutorial, automation"
                className="w-full rounded-radius-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-text-primary placeholder-text-disabled focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/30"
              />
            </div>
          </div>

          {/* Per-card "add more photos" picker (openspec/changes/tiktok-photo-post
              Decision 7) — only for a photo-typed card; grows past the one
              raw-dropped/picked photo toward TikTok's 35-photo cap without
              affecting sibling cards in the same batch. Choice-first (upload
              vs. library) to match the single-mode UploadCard flow instead of
              jumping straight to the library grid. */}
          {item.contentType === "photo" && (
            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <p className="text-xs text-text-disabled">
                  {photoCountLabel(item.photoUrls.length + (item.file ? 1 : 0))}
                </p>
                {item.photoUrls.length > 1 && (
                  <button
                    type="button"
                    onClick={onSplitCarousel}
                    className="shrink-0 text-xs font-medium text-text-secondary underline decoration-dotted transition-colors hover:text-text-primary"
                  >
                    Split into separate posts
                  </button>
                )}
              </div>
              {item.photoUrls.length === 0 && !item.file && (
                <p className="mb-1.5 text-xs text-warning">Add at least one photo to schedule this post.</p>
              )}

              {addPhotoMode === "closed" && (
                <button
                  type="button"
                  onClick={() => {
                    if (status !== "authenticated") {
                      openSignInModal();
                      return;
                    }
                    setAddPhotoMode(item.photoUrls.length >= 35 ? "closed" : "choice");
                  }}
                  disabled={item.photoUrls.length >= 35}
                  className="flex w-full items-center justify-center gap-1.5 rounded-radius-xl border border-dashed border-white/10 px-3 py-2.5 text-xs font-medium text-text-secondary transition-colors hover:border-white/20 hover:text-N900 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add photos
                </button>
              )}

              {addPhotoMode === "choice" && (
                <div className="rounded-lg border border-white/10 bg-white/5 p-3.5">
                  <div className="mb-2.5 flex items-center justify-between">
                    <p className="text-sm font-semibold text-N900">Add photos to this post</p>
                    <button
                      type="button"
                      onClick={() => setAddPhotoMode("closed")}
                      aria-label="Cancel"
                      className="text-text-disabled transition-colors hover:text-N900"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setAddPhotoMode("closed");
                        newPhotoInputRef.current?.click();
                      }}
                      className="flex flex-col items-center gap-1.5 rounded-radius-xl border border-white/10 bg-white/10 px-3 py-3 text-xs font-medium text-text-secondary transition-colors hover:border-white/30 hover:text-N900"
                    >
                      <Upload className="h-4 w-4" />
                      Upload new
                    </button>
                    <button
                      type="button"
                      onClick={() => setAddPhotoMode("library")}
                      className="flex flex-col items-center gap-1.5 rounded-radius-xl border border-white/10 bg-white/10 px-3 py-3 text-xs font-medium text-text-secondary transition-colors hover:border-white/30 hover:text-N900"
                    >
                      <FolderOpen className="h-4 w-4" />
                      Choose from your library
                    </button>
                  </div>
                </div>
              )}

              {addPhotoMode === "library" && (
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-N900">Pick photos to include in this TikTok post</p>
                    <button
                      type="button"
                      onClick={() => setAddPhotoMode("closed")}
                      className="text-xs font-medium text-text-secondary transition-colors hover:text-text-secondary"
                    >
                      Done
                    </button>
                  </div>
                  {/* No `tools` allowlist — see the matching comment on
                      UploadCard's photo picker above; mediaType="image" alone
                      is what scopes this to photos, covering every image tool
                      (including "storyboard", missed by the old allowlist). */}
                  <CreationsHistory
                    hideHeader
                    mediaType="image"
                    limit={24}
                    multiSelect
                    selectedUrls={item.photoUrls}
                    onSelect={(a) => {
                      const ref = creationPhotoRef(a);
                      const next = item.photoUrls.includes(ref)
                        ? item.photoUrls.filter((u) => u !== ref)
                        : item.photoUrls.length >= 35
                          ? item.photoUrls
                          : [...item.photoUrls, ref];
                      onUpdate({ photoUrls: next });
                    }}
                    showCreateCta
                    gridClassName="grid grid-cols-4 gap-2 sm:grid-cols-6"
                    className="!mt-0 !border-t-0 !pt-0"
                  />
                </div>
              )}

              {addPhotoStatus === "uploading" && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-text-secondary">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Uploading…
                </p>
              )}
              {addPhotoStatus === "error" && (
                <p className="mt-2 text-xs text-error">{addPhotoError ?? "Upload failed."}</p>
              )}
              <input
                ref={newPhotoInputRef}
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                onChange={handleAddPhotoFiles}
                className="hidden"
                aria-label="Upload new photo"
              />
            </div>
          )}

          <PlatformFields
            platforms={item.platforms}
            platformResults={item.platformResults}
            youtubePrivacyStatus={item.youtubePrivacyStatus}
            tiktokPrivacyLevel={item.tiktokPrivacyLevel}
            tiktokBrandOrganicToggle={item.tiktokBrandOrganicToggle}
            tiktokBrandContentToggle={item.tiktokBrandContentToggle}
            tiktokDiscloseOpen={item.tiktokDiscloseOpen}
            tiktokAllowComment={item.tiktokAllowComment}
            tiktokAllowDuet={item.tiktokAllowDuet}
            tiktokAllowStitch={item.tiktokAllowStitch}
            tiktokAutoAddMusic={item.tiktokAutoAddMusic}
            onChange={onUpdate}
            tiktokConnected={tiktokConnected}
            tiktokCreatorInfo={tiktokCreatorInfo}
            contentType={item.contentType}
            videoDurationSec={item.duration}
            errorFields={errorFields}
            idPrefix={`${item.id}-`}
            platformAvailability={platformAvailability}
          />

          {tiktokTargeted && !tiktokCreatorInfoBlocksSchedule(tiktokCreatorInfo) && (
            <TikTokConsentDeclaration
              brandContentToggle={item.tiktokBrandContentToggle}
              checked={item.tiktokConsentChecked}
              onCheckedChange={(checked) => onUpdate({ tiktokConsentChecked: checked })}
              showError={errorFields.includes("tiktokConsent")}
              idPrefix={`${item.id}-`}
            />
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                <Calendar className="mr-1 inline h-3 w-3" />
                Date <span className="text-error">*</span>
              </label>
              <input
                type="date"
                value={item.date}
                min={today}
                onChange={(e) => onUpdate({ date: e.target.value })}
                className={`w-full rounded-radius-xl border bg-white/10 px-2.5 py-2 text-sm text-text-primary [color-scheme:dark] focus:outline-none focus:ring-1 ${
                  errorFields.includes("date") ? "border-error focus:border-error focus:ring-error" : "border-white/10 focus:border-white/40 focus:ring-white/30"
                }`}
              />
              {errorFields.includes("date") && <p className="mt-1 text-xs text-error">{MISSING_FIELD_MESSAGES.date}</p>}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                <Clock className="mr-1 inline h-3 w-3" />
                Time <span className="text-error">*</span>
              </label>
              <input
                type="time"
                value={item.time}
                onChange={(e) => onUpdate({ time: e.target.value })}
                className={`w-full rounded-radius-xl border bg-white/10 px-2.5 py-2 text-sm text-text-primary [color-scheme:dark] focus:outline-none focus:ring-1 ${
                  errorFields.includes("time") ? "border-error focus:border-error focus:ring-error" : "border-white/10 focus:border-white/40 focus:ring-white/30"
                }`}
              />
              {errorFields.includes("time") && <p className="mt-1 text-xs text-error">{MISSING_FIELD_MESSAGES.time}</p>}
            </div>
          </div>
          {errorFields.includes("media") && (
            <p className="text-xs text-error">{MISSING_FIELD_MESSAGES.media} above.</p>
          )}

          <div>
            <textarea
              value={item.caption}
              onChange={(e) => onUpdate({ caption: e.target.value })}
              placeholder={
                captionMode === "individual"
                  ? "Caption — write here, or generate with AI below…"
                  : "Set by the shared caption above — edit to override this video…"
              }
              rows={2}
              className="w-full resize-none rounded-radius-xl border border-white/10 bg-white/10 px-3 py-2 text-sm text-text-primary placeholder-text-disabled focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/30"
            />
            <p className="mt-0.5 text-right text-[11px] text-text-disabled">
              {item.format === "short" ? `${item.caption.length} / 300 chars` : `${item.caption.length} chars`}
            </p>
          </div>

          {captionMode === "individual" && (
            <CaptionControls
              ai={ai}
              hasMedia={
                item.contentType === "photo"
                  ? item.photoUrls.length > 0 || !!item.file
                  : !!(item.storagePath || item.videoUrl || item.file)
              }
              hasContent={!!item.caption.trim()}
              hasTitle={!!item.title.trim()}
              generateLabel="Generate Caption"
              onGenerate={handleGenerate}
              onPolish={handlePolish}
              extraBusy={uploadingForCaption}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Deep-link intake ─────────────────────────────────────────────────────────

// Reads a `?assetUrl=&title=&mediaType=&caption=` hand-off and applies it exactly
// once. Sources: ReelsGen's "Schedule this post" (a video, no mediaType) and Photo
// Studio's "Schedule this post" (`mediaType=image` plus a caption). Isolated in its
// own component so the `useSearchParams()` call can sit under a <Suspense> boundary
// as App Router requires. The useRef guard makes it StrictMode-safe (effects
// double-invoke in dev) and immune to re-renders.
function DeepLinkIntake({
  onAsset,
}: {
  onAsset: (
    assetUrl: string,
    title: string | null,
    opts: { isPhoto: boolean; caption: string | null },
  ) => void;
}) {
  const searchParams = useSearchParams();
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    const assetUrl = searchParams.get("assetUrl");
    if (!assetUrl) return;
    consumed.current = true;
    onAsset(assetUrl, searchParams.get("title"), {
      isPhoto: searchParams.get("mediaType") === "image",
      caption: searchParams.get("caption"),
    });
  }, [searchParams, onAsset]);

  return null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulerDashboardPage() {
  const router = useRouter();
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const today = new Date().toISOString().split("T")[0];
  // Unified state: single mode = one item, bulk mode = 2..5 items.
  // Always holds at least one (empty) draft so the form is editable pre-upload.
  const [items, setItems] = useState<VideoItem[]>(() => [makeDraft(today)]);
  const [toast, setToast] = useState<ToastState | null>(null);
  // Task 5.1: posts state
  const [posts, setPosts] = useState<Post[]>([]);
  const [postsLoading, setPostsLoading] = useState(false);

  const single = items.length <= 1;
  const item0 = items[0];
  const item0Id = item0.id;

  const updateItem = useCallback((id: string, patch: Partial<VideoItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  const removeItem = useCallback(
    (id: string) => {
      setItems((prev) => {
        const next = prev.filter((i) => i.id !== id);
        return next.length === 0 ? [makeDraft(today)] : next;
      });
    },
    [today],
  );

  // Stable callbacks for the single-mode item. Stable identity matters because
  // onDurationChange lives in UploadCard's effect deps — an inline arrow would
  // re-run that effect every render and can loop.
  const handleItem0Remove = useCallback(() => removeItem(item0Id), [removeItem, item0Id]);
  // Receives measured duration + aspect; auto-suggests the format until the user
  // overrides it. Reads the live item via functional update to see `formatTouched`.
  const handleItem0Meta = useCallback(
    (meta: { duration: number | null; aspect: { w: number; h: number } | null }) =>
      setItems((prev) =>
        prev.map((i) =>
          i.id === item0Id
            ? {
                ...i,
                duration: meta.duration,
                aspect: meta.aspect,
                format: i.formatTouched ? i.format : suggestFormat(meta.duration, meta.aspect),
              }
            : i,
        ),
      ),
    [item0Id],
  );
  const handleItem0Format = useCallback(
    (next: VideoFormat) => updateItem(item0Id, { format: next, formatTouched: true }),
    [updateItem, item0Id],
  );
  const handleItem0Caption = useCallback(
    (c: string) => updateItem(item0Id, { caption: c }),
    [updateItem, item0Id],
  );
  const handleItem0Title = useCallback(
    (t: string) => updateItem(item0Id, { title: t }),
    [updateItem, item0Id],
  );
  const handleItem0Tags = useCallback(
    (t: string) => updateItem(item0Id, { tags: t }),
    [updateItem, item0Id],
  );

  // Restore what was typed before a gated Schedule click sent the visitor
  // through sign-in — see lib/pending-form-draft.ts. Covers both single mode
  // (title/tags/caption patched onto item0) and bulk mode (the whole `items`
  // array rebuilt from scratch, since the count itself needs restoring, not
  // just field values). Either way, every item's file is unavoidably gone —
  // it never leaves the browser as anything sessionStorage can hold — so the
  // toast always says to re-attach.
  useEffect(() => {
    const draft = consumePendingDraft<{
      title?: string;
      tags?: string;
      caption?: string;
      bulkItems?: Array<{
        title: string;
        tags: string;
        caption: string;
        platforms: Array<"youtube" | "tiktok">;
        contentType: "video" | "photo";
      }>;
    }>(window.location.pathname);
    if (!draft) return;

    if (draft.bulkItems && draft.bulkItems.length > 0) {
      setItems(
        draft.bulkItems.map((bi) => ({
          ...makeDraft(today),
          title: bi.title,
          tags: bi.tags,
          caption: bi.caption,
          platforms: bi.platforms,
          contentType: bi.contentType,
        })),
      );
      setToast({
        type: "success",
        message: "Signed in — your posts' titles/captions were saved. Please re-attach each video or photo.",
      });
      return;
    }

    updateItem(item0Id, {
      ...(draft.title ? { title: draft.title } : {}),
      ...(draft.tags ? { tags: draft.tags } : {}),
      ...(draft.caption ? { caption: draft.caption } : {}),
    });
    // The video/photo file itself can never survive this round trip (see
    // lib/pending-form-draft.ts) — say so explicitly rather than leaving the
    // visitor to notice a silently-empty upload card.
    setToast({
      type: "success",
      message: "Signed in — your title/caption were saved. Please re-attach your video or photo.",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleItem0PlatformPatch = useCallback(
    (patch: Partial<VideoItem>) => updateItem(item0Id, patch),
    [updateItem, item0Id],
  );
  const handleItem0PhotoUrls = useCallback(
    (urls: string[]) => updateItem(item0Id, { photoUrls: urls }),
    [updateItem, item0Id],
  );
  // Undo for handleFilesAdded's makeCarousel default (Q2 decision, see
  // CONTEXT.md's Carousel/Separate posts entries): replaces one carousel
  // item with N single-photo items, spaced the same way a multi-file drop
  // already is. Each new item inherits the source item's title/tags/caption
  // as a starting point (all photos were meant for one post a moment ago)
  // rather than blanking them out — bulk mode lets the user edit each
  // individually afterward.
  //
  // Takes an itemId (not just item0) — code review on this same change
  // caught that a carousel can land inside a bulk batch too (handleFilesAdded
  // merges 2+ photos regardless of how many other items already exist), and
  // the original item0-only version had no undo path for that case at all.
  // Splices the split-out items into the original item's position so
  // sibling bulk items are preserved, not dropped.
  const handleSplitCarousel = useCallback(
    (itemId: string) => {
      setItems((prev) => {
        const idx = prev.findIndex((it) => it.id === itemId);
        if (idx === -1) return prev;
        const target = prev[idx];
        const groups = splitCarouselPhotos(target.photoUrls);
        if (groups.length < 2) return prev;
        const split: VideoItem[] = groups.map((urls, k) => ({
          ...makeDraft(today),
          file: null,
          uploadStatus: "done",
          contentType: "photo",
          photoUrls: urls,
          platforms: ["tiktok"],
          title: target.title,
          tags: target.tags,
          caption: target.caption,
          ...spacedSlot(target.date, k),
        }));
        return [...prev.slice(0, idx), ...split, ...prev.slice(idx + 1)];
      });
    },
    [today],
  );
  const noop = useCallback(() => {}, []);

  // ── TikTok connection + creator info (Decisions 4, 7) ──
  const [tiktokConnected, setTiktokConnected] = useState(false);
  const [tiktokCreatorInfo, setTiktokCreatorInfo] = useState<TikTokCreatorInfoState>(DEFAULT_TIKTOK_CREATOR_INFO);
  // Instagram connection only, no creator-info equivalent yet — this step is
  // selectability only (openspec/changes/connect-instagram Phase 4, task
  // 9.1-9.2). Same /api/connections/status response as tiktokConnected, it
  // already returns both keys, so this is one fetch, not two.
  const [instagramConnected, setInstagramConnected] = useState(false);
  // Instagram's own "posting as @username" panel (parity with TikTok's,
  // which sources its nickname from the live creator-info fetch below
  // instead — TikTok doesn't need this state). YouTube excluded on purpose
  // (decided against broadening its OAuth scope — see the connect-instagram
  // Phase 4 work earlier this session).
  const [instagramUsername, setInstagramUsername] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/connections/status")
      .then((res) => (res.ok ? res.json() : { tiktok: false, instagram: false }))
      .then(
        (data: {
          tiktok?: boolean;
          instagram?: boolean;
          usernames?: { instagram?: string | null };
        }) => {
          setTiktokConnected(Boolean(data.tiktok));
          setInstagramConnected(Boolean(data.instagram));
          setInstagramUsername(data.usernames?.instagram ?? null);
        },
      )
      .catch(() => {
        setTiktokConnected(false);
        setInstagramConnected(false);
        setInstagramUsername(null);
      });
  }, []);

  // Platform availability (see CONTEXT.md) — defaults every platform to
  // available while loading/on error, so a slow or failed fetch never
  // falsely locks the compose checkboxes for a platform that's actually open.
  const [platformAvailability, setPlatformAvailability] = useState<{
    platforms: Record<Platform, boolean>;
    canBypass: Record<Platform, boolean>;
  }>({
    platforms: { tiktok: true, instagram: true, youtube: true },
    canBypass: { tiktok: false, instagram: false, youtube: false },
  });

  useEffect(() => {
    fetch("/api/platform-availability")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { platforms?: Record<Platform, boolean>; canBypass?: Record<Platform, boolean> } | null) => {
        if (data?.platforms && data.canBypass) {
          setPlatformAvailability({ platforms: data.platforms, canBypass: data.canBypass });
        }
      })
      .catch(() => {});
  }, []);

  // A coming-soon platform must never stay selected/submittable for a
  // non-bypassed user — a disabled checkbox only stops NEW clicks, it
  // doesn't retroactively clear a platform already in a draft's default
  // selection (makeDraft() below defaults every new item to ["youtube"],
  // which is "coming soon" out of the box today). Strip it the moment real
  // availability data arrives, AND every time a new item is created (a video
  // dropped after the initial load carries the same stale default, and
  // platformAvailability itself won't change again to re-trigger this) — a
  // no-op for anyone isPlatformUsable bypasses (admin, or a platform-scoped
  // tool_preview_access allowlist entry). Depending on `items` here is safe
  // from a re-render loop: the updater returns the exact same array
  // reference when nothing needs stripping, and React bails out of
  // re-rendering (and re-running this effect) on a referentially-equal
  // functional update.
  useEffect(() => {
    setItems((prev) => {
      let changed = false;
      const next = prev.map((it) => {
        const usable = it.platforms.filter((p) =>
          isPlatformUsable(platformAvailability.platforms[p], platformAvailability.canBypass[p]),
        );
        if (usable.length === it.platforms.length) return it;
        changed = true;
        return { ...it, platforms: usable };
      });
      return changed ? next : prev;
    });
  }, [platformAvailability, items]);

  useEffect(() => {
    if (!tiktokConnected) {
      setTiktokCreatorInfo(DEFAULT_TIKTOK_CREATOR_INFO);
      return;
    }
    fetch("/api/connections/tiktok/creator-info")
      .then(async (res) => {
        const httpKind = classifyTikTokCreatorInfoHttp(res.status).kind;
        const data: Partial<TikTokCreatorInfoState> = res.ok ? await res.json() : {};
        setTiktokCreatorInfo({ ...DEFAULT_TIKTOK_CREATOR_INFO, ...data, httpKind });
      })
      .catch(() =>
        setTiktokCreatorInfo({ ...DEFAULT_TIKTOK_CREATOR_INFO, httpKind: "unavailable" }),
      );
  }, [tiktokConnected]);

  // ── Bulk caption state (Prompt 2) ──
  const [captionMode, setCaptionMode] = useState<"individual" | "same">("individual");
  const [sharedCaption, setSharedCaption] = useState("");
  const sharedAi = useCaptionAI();

  const applyCaptionToAll = useCallback((text: string) => {
    setItems((prev) => prev.map((i) => ({ ...i, caption: text })));
  }, []);

  // General caption is built purely from the title + tags creators typed on each
  // card (no audio). Send only the cards that actually have something filled in.
  const captionContexts = items
    .map((i) => ({ title: i.title.trim(), tags: i.tags.trim() }))
    .filter((c) => c.title || c.tags);
  const hasCaptionContext = captionContexts.length > 0;

  const handleSharedChange = (text: string) => {
    setSharedCaption(text);
    applyCaptionToAll(text);
  };

  const handleSharedGenerate = async () => {
    if (!hasCaptionContext) return;
    try {
      const caption = await sharedAi.generateGeneral(captionContexts);
      setSharedCaption(caption);
      applyCaptionToAll(caption);
    } catch {
      // error surfaced by the hook
    }
  };

  const handleSharedPolish = async () => {
    try {
      const caption = await sharedAi.polish(sharedCaption);
      setSharedCaption(caption);
      applyCaptionToAll(caption);
    } catch {
      // error surfaced by the hook
    }
  };

  // Task 5.1: fetch posts
  const fetchPosts = useCallback(async () => {
    setPostsLoading(true);
    try {
      const res = await fetch("/api/posts");
      if (!res.ok) return;
      const data = await res.json();
      const all: Post[] = data.posts ?? [];
      const sorted = [...all].sort(
        (a, b) => new Date(b.scheduled_time).getTime() - new Date(a.scheduled_time).getTime(),
      );
      setPosts(sorted.slice(0, 5));
    } finally {
      setPostsLoading(false);
    }
  }, []);

  // Task 5.1: fetch on mount; Task 5.2: auto-refresh every 30s
  useEffect(() => {
    fetchPosts();
    const interval = setInterval(fetchPosts, 30_000);
    return () => clearInterval(interval);
  }, [fetchPosts]);

  // Accept 1..N files. 1 valid file → single mode; 2..5 → bulk mode.
  // Existing real videos are kept; the empty draft is dropped once real ones exist.
  // Unified dropzone (openspec/changes/tiktok-photo-post Decisions 6-8):
  // accepts a mixed batch of video + image files. Each file becomes exactly
  // one card (no auto-grouping of multiple photos into one carousel) with
  // its own contentType derived from the file's actual MIME type.
  const handleFilesAdded = useCallback(
    async (files: File[]) => {
      const valid: Array<{ file: File; contentType: "video" | "photo" }> = [];
      for (const f of files) {
        if (ACCEPTED_VIDEO_TYPES.includes(f.type)) {
          if (f.size > MAX_FILE_BYTES) {
            setToast({ type: "error", message: `"${f.name}" skipped — over 50MB.` });
            continue;
          }
          valid.push({ file: f, contentType: "video" });
        } else if (ACCEPTED_IMAGE_TYPES.includes(f.type)) {
          if (f.size > MAX_IMAGE_BYTES) {
            setToast({ type: "error", message: `"${f.name}" skipped — over 10MB.` });
            continue;
          }
          valid.push({ file: f, contentType: "photo" });
        } else {
          setToast({ type: "error", message: `"${f.name}" skipped — unsupported file type.` });
        }
      }
      if (valid.length === 0) return;

      // A carousel item has no `.file` (its photos are uploaded immediately,
      // below) — must count it as "real" too, or a second handleFilesAdded
      // call would under-count how many item-slots are already used.
      const existingReal = items.filter((i) => i.file || i.photoUrls.length > 0);
      const slots = MAX_VIDEOS - existingReal.length;
      if (slots <= 0) {
        setToast({ type: "error", message: `Max ${MAX_VIDEOS} items reached.` });
        return;
      }
      const accepted = valid.slice(0, slots);
      if (valid.length > slots) {
        setToast({ type: "error", message: `Max ${MAX_VIDEOS} items — extra files were skipped.` });
      }

      // 2+ photos dropped in the same batch become ONE carousel post instead
      // of N separate ones. Uploaded immediately here (unlike the deferred
      // single-file path below) because photoUrls holds real storage paths,
      // not staged File objects — mirrors handleAddPhotoFiles' upload-now
      // pattern (the existing "add more to this card" mechanism) for the
      // same reason. A single photo keeps the old deferred behavior
      // unchanged, so "pick more from history" afterward still works exactly
      // as before.
      const acceptedPhotos = accepted.filter((a) => a.contentType === "photo");
      const acceptedVideos = accepted.filter((a) => a.contentType === "video");
      // The carousel-vs-separate decision itself is tested in isolation —
      // see lib/scheduler-carousel-pure.ts's planDroppedItems and
      // npm run test:scheduler-carousel — rather than re-deriving the same
      // ">= 2" rule inline here with nothing checking it stays right.
      const makeCarousel = planDroppedItems(accepted.map((a) => a.contentType)).some(
        (i) => i.kind === "carousel",
      );

      const newItems: VideoItem[] = [];

      if (makeCarousel) {
        const uploaded: string[] = [];
        let firstError: string | null = null;
        for (const { file } of acceptedPhotos) {
          try {
            const { storagePath } = await signAndUploadFile(file, "image");
            uploaded.push(storagePath);
          } catch (err) {
            firstError = err instanceof Error ? err.message : "Upload failed.";
          }
        }
        if (uploaded.length > 0) {
          newItems.push({
            ...makeDraft(today),
            file: null,
            uploadStatus: "done",
            contentType: "photo",
            photoUrls: uploaded,
            platforms: ["tiktok"],
          });
        }
        if (firstError) {
          setToast({ type: "error", message: firstError });
        }
      } else {
        for (const { file, contentType } of acceptedPhotos) {
          newItems.push({
            ...makeDraft(today),
            file,
            uploadStatus: "idle",
            contentType,
            platforms: ["tiktok"],
          });
        }
      }

      for (const { file, contentType } of acceptedVideos) {
        newItems.push({
          ...makeDraft(today),
          // Upload is deferred until "Schedule" is clicked (see
          // ScheduleCard.handleSubmit / handleScheduleAll) — selecting a
          // file here only stages it locally; its preview renders straight
          // from the File object (URL.createObjectURL), no network call yet.
          file,
          uploadStatus: "idle",
          contentType,
          platforms: ["youtube"],
        });
      }

      // Auto-space (Prompt 4): once the batch reaches 2+ items, lay the NEW
      // cards into 2-per-day slots (12:00 / 18:00), continuing from the existing
      // count and anchored to the first card's date. Existing cards keep their
      // date/time so any manual edits are preserved.
      const willBeBulk = existingReal.length + newItems.length >= 2;
      const anchorDate = (existingReal[0] ?? newItems[0])?.date ?? today;
      const spacedNew = willBeBulk
        ? newItems.map((it, k) => ({
            ...it,
            ...spacedSlot(anchorDate, existingReal.length + k),
          }))
        : newItems;
      setItems([...existingReal, ...spacedNew]);
    },
    [items, today],
  );

  // Pick an existing creation (video OR product photo) as a schedulable item
  // — no /api/upload. Fills the first empty draft in place (keeps single mode
  // single); otherwise appends a new card (auto-spaced like uploads) up to
  // MAX_VIDEOS. mediaType drives the same contentType auto-detection as a raw
  // drop (openspec/changes/tiktok-photo-post Decision 6). A bare string is always
  // a video — photo hand-offs pass an object so `mediaType` can say so.
  const handleAssetSelected = useCallback(
    (source: SchedulableSource) => {
      const isPhoto = typeof source !== "string" && source.mediaType === "image";
      const mediaUrl = typeof source === "string" ? source : source.mediaUrl;
      const storagePath =
        typeof source === "string"
          ? isStorageRelativePath(source)
            ? source
            : storagePathFromStorageUrl(source)
          : source.storagePath?.trim() || null;
      const photoRef = isPhoto ? storagePath ?? mediaUrl : null;
      const assetPatch: Partial<VideoItem> = {
        videoUrl: isPhoto ? null : mediaUrl,
        storagePath: isPhoto ? null : storagePath,
        photoUrls: photoRef ? [photoRef] : [],
        contentType: isPhoto ? "photo" : "video",
        uploadStatus: "done",
        uploadError: null,
        file: null,
        duration: null,
        aspect: null,
        format: "short",
        formatTouched: false,
        scheduleStatus: "idle",
        scheduleError: null,
        // Photo posts are TikTok-only — defensively override even if the
        // reused/new card would otherwise default or already hold YouTube.
        ...(isPhoto ? { platforms: ["tiktok"] as Array<"youtube" | "tiktok"> } : {}),
      };

      const hasHostedMedia = (i: VideoItem) =>
        !!(i.storagePath || i.videoUrl || i.photoUrls.length > 0);
      const reusableIdx = items.findIndex(
        (i) =>
          (!i.file && !hasHostedMedia(i)) ||
          (i.uploadStatus === "error" && !hasHostedMedia(i)),
      );
      if (reusableIdx !== -1) {
        updateItem(items[reusableIdx].id, assetPatch);
        return;
      }

      if (items.length >= MAX_VIDEOS) {
        setToast({ type: "error", message: `Max ${MAX_VIDEOS} items reached.` });
        return;
      }

      const newItem: VideoItem = { ...makeDraft(today), ...assetPatch };
      if (items.length + 1 >= 2) {
        const anchorDate = items[0]?.date ?? today;
        const slot = spacedSlot(anchorDate, items.length);
        newItem.date = slot.date;
        newItem.time = slot.time;
      }
      setItems((prev) => [...prev, newItem]);
    },
    [items, today, updateItem],
  );

  // Deep-link hand-off: Reels Creator → "Schedule this post" (a video) and Photo
  // Studio → "Schedule this post" (a photo, with a caption). Reuses the asset intake
  // above, then pre-fills title/caption on the card that now holds the asset (the
  // prior setItems updates are already queued, so this functional update sees the
  // just-added/filled item). Photo cards land with no platform ticked so the user
  // picks the destination; the intake would otherwise default them to TikTok.
  // Finally strips the query params so a refresh doesn't re-trigger and the URL
  // stays clean.
  const handleDeepLinkAsset = useCallback(
    (
      assetUrl: string,
      title: string | null,
      opts: { isPhoto: boolean; caption: string | null },
    ) => {
      // Same path resolution the string (video) branch of the intake performs, so
      // the ref we match on below is the one the card actually stores.
      const photoPath = isStorageRelativePath(assetUrl)
        ? assetUrl
        : storagePathFromStorageUrl(assetUrl);
      handleAssetSelected(
        opts.isPhoto
          ? { mediaType: "image", mediaUrl: assetUrl, storagePath: photoPath }
          : assetUrl,
      );
      const patch: Partial<VideoItem> = {};
      if (title && title.trim()) patch.title = title.trim();
      if (opts.caption && opts.caption.trim()) patch.caption = opts.caption.trim();
      if (opts.isPhoto) patch.platforms = [];
      if (Object.keys(patch).length > 0) {
        setItems((prev) => {
          const idx = prev.findIndex((i) =>
            opts.isPhoto
              ? i.photoUrls.includes(photoPath ?? assetUrl)
              : i.videoUrl === assetUrl || i.storagePath === assetUrl,
          );
          if (idx === -1) return prev;
          return prev.map((i, k) => (k === idx ? { ...i, ...patch } : i));
        });
      }
      router.replace("/tools/scheduler");
    },
    [handleAssetSelected, router],
  );

  const handleSuccess = useCallback(() => {
    setItems([makeDraft(today)]);
    fetchPosts();
  }, [fetchPosts, today]);

  // ── Schedule All (Prompt 3) ──
  const [schedulingAll, setSchedulingAll] = useState(false);
  // Empty caption is confirmed once for the whole batch, not per card.
  const [confirmEmptyBatch, setConfirmEmptyBatch] = useState(false);
  // Set once Schedule All has been clicked with at least one card unready —
  // flags ALL unready cards at once (a grilled decision, see CONTEXT.md),
  // not just the first, so one click surfaces the whole picture instead of a
  // fix-one-click-again loop across multiple cards.
  const [bulkShowErrors, setBulkShowErrors] = useState(false);

  // A card is schedulable when it has hosted media (a video URL, or at least
  // one photo for a photo-typed card — openspec/changes/tiktok-photo-post
  // Decision 7's empty-photo-card guard), a title, and a date/time — shares
  // its actual rule-set with single mode's ScheduleCard via
  // getMissingFields (lib/schedule-validation-pure.ts) rather than a second,
  // independently-maintained boolean expression.
  const getItemMissingFields = useCallback(
    (i: VideoItem): MissingField[] => {
      const hasMedia = i.contentType === "photo" ? (i.photoUrls.length > 0 || !!i.file) : !!(i.storagePath || i.videoUrl || i.file);
      const targetsTikTok = i.platforms.includes("tiktok");
      const tiktokNotBlocked = !targetsTikTok || !tiktokCreatorInfoBlocksSchedule(tiktokCreatorInfo);
      const tiktokDurationOk =
        !targetsTikTok || !i.duration || !tiktokCreatorInfo.maxVideoPostDurationSec || i.duration <= tiktokCreatorInfo.maxVideoPostDurationSec;
      const tiktokDiscloseComplete =
        !targetsTikTok || !i.tiktokDiscloseOpen || i.tiktokBrandOrganicToggle || i.tiktokBrandContentToggle;
      const tiktokConsentOk = !targetsTikTok || i.tiktokConsentChecked;
      return getMissingFields({
        hasMedia,
        title: i.title,
        date: i.date,
        time: i.time,
        platformCount: i.platforms.length,
        // Bulk mode retries at the whole-card level (scheduleStatus), not
        // per-platform like single mode's platformResults.
        pendingPlatformCount: i.platforms.length,
        targetsTikTok,
        tiktokPrivacyLevel: i.tiktokPrivacyLevel,
        tiktokNotBlocked,
        tiktokDurationOk,
        tiktokDiscloseComplete,
        tiktokConsentOk,
      });
    },
    [tiktokCreatorInfo],
  );
  const itemReady = useCallback((i: VideoItem) => getItemMissingFields(i).length === 0, [getItemMissingFields]);

  // Targets = ready cards not already scheduled (so a re-run retries failures too).
  const scheduleTargets = items.filter(
    (i) => itemReady(i) && i.scheduleStatus !== "scheduled",
  );
  const hasScheduled = items.some((i) => i.scheduleStatus === "scheduled");

  // Reset the batch confirm if the set of empty-caption targets changes underneath.
  useEffect(() => {
    if (confirmEmptyBatch && scheduleTargets.every((i) => i.caption.trim())) {
      setConfirmEmptyBatch(false);
    }
  }, [confirmEmptyBatch, scheduleTargets]);

  const handleScheduleAll = async () => {
    const targets = items.filter(
      (i) => itemReady(i) && i.scheduleStatus !== "scheduled",
    );
    const unready = items.filter(
      (i) => !itemReady(i) && i.scheduleStatus !== "scheduled",
    );
    if (unready.length > 0) {
      setBulkShowErrors(true);
      document.getElementById(`bulk-card-${unready[0].id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      setBulkShowErrors(false);
    }
    if (targets.length === 0 || schedulingAll) return;

    if (status !== "authenticated") {
      openSignInModal(undefined, {
        bulkItems: items.map((i) => ({
          title: i.title,
          tags: i.tags,
          caption: i.caption,
          platforms: i.platforms,
          contentType: i.contentType,
        })),
      });
      return;
    }

    // One confirming click for the whole batch when any target has no caption.
    const anyEmptyCaption = targets.some((i) => !i.caption.trim());
    if (anyEmptyCaption && !confirmEmptyBatch) {
      setConfirmEmptyBatch(true);
      return;
    }

    setConfirmEmptyBatch(false);
    setSchedulingAll(true);

    const targetIds = new Set(targets.map((t) => t.id));
    setItems((prev) =>
      prev.map((i) =>
        targetIds.has(i.id)
          ? { ...i, scheduleStatus: "scheduling", scheduleError: null }
          : i,
      ),
    );

    // Retry-safe: only (re-)submit platforms that haven't already succeeded
    // on a prior attempt for this card (see
    // openspec/changes/fix-schedule-retry-duplication/design.md) — a card
    // that partially failed no longer re-POSTs the platform(s) that already
    // created a `posts` row.
    let success = 0;
    for (const it of targets) {
      // Upload the staged file now, if there is one — this is the point
      // upload was deferred to (see handleFilesAdded). A failure here skips
      // straight to the next target rather than attempting a POST with no
      // media; the card is marked "failed" so the user can see and retry it.
      let effectiveVideoUrl = it.videoUrl;
      let effectiveStoragePath = it.storagePath;
      let effectivePhotoUrls = it.photoUrls;

      if (it.file) {
        updateItem(it.id, { uploadStatus: "uploading" });
        try {
          const isPhotoFile = it.contentType === "photo";
          const uploaded = await signAndUploadFile(it.file, isPhotoFile ? "image" : "video");
          if (isPhotoFile) {
            // The staged file is always the cover (position 0) — it was the
            // first photo selected for this card.
            effectivePhotoUrls = [uploaded.storagePath, ...it.photoUrls];
            updateItem(it.id, { photoUrls: effectivePhotoUrls, file: null, uploadStatus: "done" });
          } else {
            effectiveVideoUrl = uploaded.url;
            effectiveStoragePath = uploaded.storagePath;
            updateItem(it.id, { videoUrl: uploaded.url, storagePath: uploaded.storagePath, file: null, uploadStatus: "done" });
          }
        } catch (err) {
          const uploadMessage = err instanceof Error ? err.message : "Upload failed.";
          updateItem(it.id, {
            scheduleStatus: "failed",
            scheduleError: uploadMessage,
            uploadStatus: "error",
            uploadError: uploadMessage,
          });
          continue;
        }
      }

      const scheduled_time = new Date(`${it.date}T${it.time}:00`).toISOString();
      const pendingPlatforms = it.platforms.filter((p) => it.platformResults[p]?.status !== "success");

      const results = await Promise.allSettled(
        pendingPlatforms.map(async (p) => {
          const description = p === "youtube" && it.format === "short" ? withShortsTag(it.caption) : it.caption;
          // A TikTok photo post sends photo_urls instead of video_url — same
          // rule as single-mode ScheduleCard's submit (openspec/changes/
          // tiktok-photo-post). YouTube is never reachable here since a
          // photo-typed card can't have "youtube" in platforms.
          const isPhoto = it.contentType === "photo";
          const res = await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...(isPhoto
                ? { photo_urls: effectivePhotoUrls }
                : effectiveStoragePath
                  ? { storage_path: effectiveStoragePath }
                  : { video_url: effectiveVideoUrl }),
              title: it.title.trim(),
              description,
              tags: it.tags,
              scheduled_time,
              platform: p,
              ...(p === "youtube" ? { format: it.format, youtube_privacy_status: it.youtubePrivacyStatus } : {}),
              ...(p === "tiktok"
                ? {
                    tiktok_privacy_level: it.tiktokPrivacyLevel,
                    tiktok_brand_organic_toggle: it.tiktokBrandOrganicToggle,
                    tiktok_brand_content_toggle: it.tiktokBrandContentToggle,
                    tiktok_disable_comment: !it.tiktokAllowComment,
                    tiktok_disable_duet: isPhoto ? true : !it.tiktokAllowDuet,
                    tiktok_disable_stitch: isPhoto ? true : !it.tiktokAllowStitch,
                    ...(isPhoto ? { tiktok_auto_add_music: it.tiktokAutoAddMusic } : {}),
                  }
                : {}),
            }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error ?? "Failed to schedule post.");
          return p;
        }),
      );

      // Merge this attempt's outcomes into any results carried over from a
      // prior partial failure.
      const newResults: Partial<Record<"youtube" | "tiktok" | "instagram", PlatformResult>> = {};
      results.forEach((r, i2) => {
        const p = pendingPlatforms[i2];
        newResults[p] =
          r.status === "fulfilled"
            ? { status: "success" }
            : { status: "failed", error: r.reason instanceof Error ? r.reason.message : "failed" };
      });
      const mergedResults = { ...it.platformResults, ...newResults };

      const failed = it.platforms
        .filter((p) => mergedResults[p]?.status === "failed")
        .map((p) => `${PLATFORM_LABELS[p]}: ${mergedResults[p]?.error ?? "failed"}`);

      if (failed.length === 0) {
        success += 1;
        updateItem(it.id, { scheduleStatus: "scheduled", scheduleError: null, platformResults: mergedResults });
      } else {
        updateItem(it.id, { scheduleStatus: "failed", scheduleError: failed.join("; "), platformResults: mergedResults });
      }
    }

    setSchedulingAll(false);
    setToast({
      type: success === targets.length ? "success" : "error",
      message: `${success}/${targets.length} videos scheduled successfully`,
    });
    fetchPosts();
  };

  // Dismiss saved cards once the user is done with them; failed/idle cards stay
  // (failed ones remain for retry). Falls back to a fresh draft if nothing's left.
  const clearScheduledItems = useCallback(() => {
    setItems((prev) => {
      const next = prev.filter((i) => i.scheduleStatus !== "scheduled");
      return next.length === 0 ? [makeDraft(today)] : next;
    });
  }, [today]);

  // Task 5.6: retry a failed post
  const handleRetry = useCallback(async (postId: string) => {
    try {
      await fetch(`/api/posts/${postId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "scheduled" }),
      });
      fetchPosts();
    } catch {
      // silently ignore; cron will reflect the state
    }
  }, [fetchPosts]);

  return (
    <div className="min-h-screen">
      <Suspense fallback={null}>
        <DeepLinkIntake onAsset={handleDeepLinkAsset} />
      </Suspense>
      <PageContainer>
        <PageHeader title="Create & Schedule" />

        {single ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              <UploadCard
                file={item0.file}
                videoUrl={item0.videoUrl}
                storagePath={item0.storagePath}
                uploadStatus={item0.uploadStatus}
                uploadError={item0.uploadError}
                onFilesAdded={handleFilesAdded}
                onRemove={handleItem0Remove}
                onMetaChange={handleItem0Meta}
                onAssetSelected={handleAssetSelected}
                format={item0.format}
                contentType={item0.contentType}
                photoUrls={item0.photoUrls}
                onPhotoUrlsChange={handleItem0PhotoUrls}
                onSplitCarousel={() => handleSplitCarousel(item0Id)}
              />
              <DescriptionCard
                caption={item0.caption}
                onCaptionChange={handleItem0Caption}
                title={item0.title}
                tags={item0.tags}
                videoUrl={item0.videoUrl}
                storagePath={item0.storagePath}
                contentType={item0.contentType}
                photoUrls={item0.photoUrls}
                format={item0.format}
                file={item0.file}
                onMediaUploaded={handleItem0PlatformPatch}
              />
            </div>

            <div>
              <ScheduleCard
                videoUrl={item0.videoUrl}
                storagePath={item0.storagePath}
                file={item0.file}
                caption={item0.caption}
                onSuccess={handleSuccess}
                onPostCreated={fetchPosts}
                onToast={setToast}
                videoDuration={item0.duration}
                videoAspect={item0.aspect}
                format={item0.format}
                onFormatChange={handleItem0Format}
                title={item0.title}
                tags={item0.tags}
                onTitleChange={handleItem0Title}
                onTagsChange={handleItem0Tags}
                platforms={item0.platforms}
                platformResults={item0.platformResults}
                youtubePrivacyStatus={item0.youtubePrivacyStatus}
                tiktokPrivacyLevel={item0.tiktokPrivacyLevel}
                tiktokBrandOrganicToggle={item0.tiktokBrandOrganicToggle}
                tiktokBrandContentToggle={item0.tiktokBrandContentToggle}
                tiktokDiscloseOpen={item0.tiktokDiscloseOpen}
                tiktokAllowComment={item0.tiktokAllowComment}
                tiktokAllowDuet={item0.tiktokAllowDuet}
                tiktokAllowStitch={item0.tiktokAllowStitch}
                tiktokAutoAddMusic={item0.tiktokAutoAddMusic}
                tiktokConsentChecked={item0.tiktokConsentChecked}
                onPlatformPatch={handleItem0PlatformPatch}
                onMediaUploaded={handleItem0PlatformPatch}
                tiktokConnected={tiktokConnected}
                tiktokCreatorInfo={tiktokCreatorInfo}
                instagramConnected={instagramConnected}
                instagramUsername={instagramUsername}
                contentType={item0.contentType}
                photoUrls={item0.photoUrls}
                platformAvailability={platformAvailability}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <UploadCard
              file={null}
              videoUrl={null}
              storagePath={null}
              uploadStatus="idle"
              uploadError={null}
              onFilesAdded={handleFilesAdded}
              onRemove={noop}
              onMetaChange={noop}
              onAssetSelected={handleAssetSelected}
              format="short"
            />

            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-text-secondary">Caption</span>
              <div className="inline-flex rounded-lg border border-white/10 bg-white/10 p-0.5">
                <button
                  type="button"
                  onClick={() => setCaptionMode("individual")}
                  className={`cursor-pointer rounded-radius-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                    captionMode === "individual"
                      ? "bg-bg-static-white text-text-static-black"
                      : "text-text-secondary hover:text-N900"
                  }`}
                >
                  Individual
                </button>
                <button
                  type="button"
                  onClick={() => setCaptionMode("same")}
                  className={`cursor-pointer rounded-radius-xl px-3 py-1.5 text-xs font-medium transition-colors ${
                    captionMode === "same"
                      ? "bg-bg-static-white text-text-static-black"
                      : "text-text-secondary hover:text-N900"
                  }`}
                >
                  Same for all
                </button>
              </div>
            </div>

            {captionMode === "same" && (
              <Card>
                <CardHeader title="Caption — same for all" icon={<Sparkles className="h-4 w-4" />} />
                <div className="space-y-4 p-5">
                  <div>
                    <textarea
                      value={sharedCaption}
                      onChange={(e) => handleSharedChange(e.target.value)}
                      placeholder="Write one caption for every video, or generate a general one from your titles & tags below…"
                      rows={4}
                      aria-label="Shared caption for all videos"
                      className="w-full resize-none rounded-radius-xl border border-white/10 bg-white/10 px-3.5 py-3 text-sm text-text-primary placeholder-text-disabled transition-colors focus:border-white/40 focus:outline-none focus:ring-1 focus:ring-white/30"
                    />
                    <p className="mt-1 text-right text-xs text-text-disabled">
                      {sharedCaption.length} / 300 chars
                    </p>
                  </div>

                  <CaptionControls
                    ai={sharedAi}
                    hasMedia={hasCaptionContext}
                    hasContent={!!sharedCaption.trim()}
                    hasTitle
                    generateLabel="✨ Generate General Caption"
                    onGenerate={handleSharedGenerate}
                    onPolish={handleSharedPolish}
                    emptyHint={null}
                  />

                  <p className="text-xs text-text-disabled">
                    {hasCaptionContext
                      ? "Generated from the titles & tags of all your videos (no audio) — one caption that broadly fits the whole batch. Applies to all videos; edit any card below to override."
                      : "Add a title or tags to at least one video to generate a shared caption."}
                  </p>
                </div>
              </Card>
            )}

            <div
              role="status"
              className="flex items-start gap-2.5 rounded-lg border border-info/25 bg-info/10 px-4 py-3"
            >
              <Info className="mt-px h-4 w-4 shrink-0 text-info" />
              <p className="text-xs text-info">
                Posts are spread across days for optimal reach (max 2/day at 12:00 &amp; 18:00).
                Adjust per card if needed.
              </p>
            </div>

            <div className="space-y-4">
              {items.map((it, idx) => (
                <BulkVideoCard
                  key={it.id}
                  item={it}
                  index={idx}
                  captionMode={captionMode}
                  onUpdate={(patch) => updateItem(it.id, patch)}
                  onRemove={() => removeItem(it.id)}
                  tiktokConnected={tiktokConnected}
                  tiktokCreatorInfo={tiktokCreatorInfo}
                  onSplitCarousel={() => handleSplitCarousel(it.id)}
                  showErrors={bulkShowErrors}
                  platformAvailability={platformAvailability}
                />
              ))}
            </div>

            <div className="space-y-2">
              {confirmEmptyBatch && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning/10 px-3.5 py-3"
                >
                  <AlertCircle className="mt-px h-4 w-4 shrink-0 text-warning" />
                  <p className="text-xs text-warning">
                    ⚠️ Some videos have no caption. Click “Schedule All” again to publish them
                    without a caption, or add captions above.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={handleScheduleAll}
                disabled={schedulingAll}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-radius-xl bg-bg-static-white px-4 py-3 text-sm font-semibold text-text-static-black shadow-lg shadow-N0/30 transition-all duration-200 hover:bg-N800 hover:shadow-N0/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                {schedulingAll ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Scheduling…
                  </>
                ) : (
                  <>
                    <Calendar className="h-4 w-4" />
                    Schedule All ({scheduleTargets.length})
                  </>
                )}
              </button>
              {bulkShowErrors && scheduleTargets.length < items.filter((i) => i.scheduleStatus !== "scheduled").length && (
                <p className="text-center text-xs text-error">Fix the highlighted card(s) above to schedule everything.</p>
              )}

              {hasScheduled && !schedulingAll && (
                <button
                  type="button"
                  onClick={clearScheduledItems}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-radius-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-text-secondary transition-colors hover:border-white/20 hover:text-N900"
                >
                  Clear scheduled & keep editing
                </button>
              )}

              <p className="text-center text-xs text-text-disabled">
                {scheduleTargets.length > 0
                  ? "Schedules every ready video to YouTube. Failed cards stay for retry."
                  : hasScheduled
                    ? "Scheduled videos are saved — see them below. Clear them to start a new batch."
                    : "Add a title, date & time to each video to enable scheduling."}
              </p>
            </div>
          </div>
        )}

        {/* Task 5.9: Recent posts — full width below the grid */}
        <div className="mt-6">
          <RecentPostsCard
            posts={posts}
            loading={postsLoading}
            onRetry={handleRetry}
          />
        </div>
      </PageContainer>

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
