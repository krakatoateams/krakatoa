"use client";

import { useState, useRef, useCallback, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import CreationsHistory from "@/components/CreationsHistory";
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
  ChevronDown,
  AlertCircle,
  X,
  CalendarDays,
  ExternalLink,
  ArrowRight,
  Info,
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
  status: "draft" | "scheduled" | "published" | "failed";
  scheduled_time: string;
  youtube_video_id?: string | null;
  platform: string;
}

// Bulk scheduling: one record per video (single mode = one item)
// Per-card scheduling lifecycle for bulk "Schedule All" (Prompt 3)
type ScheduleStatus = "idle" | "scheduling" | "scheduled" | "failed";

interface VideoItem {
  id: string;
  file: File | null;
  videoUrl: string | null;
  uploadStatus: UploadStatus;
  uploadError: string | null;
  duration: number | null;
  title: string;
  tags: string;
  caption: string;
  date: string;
  time: string;
  scheduleStatus: ScheduleStatus;
  scheduleError: string | null;
}

const ACCEPTED_VIDEO_TYPES = ["video/mp4", "video/quicktime", "video/avi", "video/x-msvideo"];
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_VIDEOS = 5;

function makeDraft(date: string, time = "18:00"): VideoItem {
  return {
    id: crypto.randomUUID(),
    file: null,
    videoUrl: null,
    uploadStatus: "idle",
    uploadError: null,
    duration: null,
    title: "",
    tags: "",
    caption: "",
    date,
    time,
    scheduleStatus: "idle",
    scheduleError: null,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
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
          ? "border-green-500/30 bg-green-500/10 text-green-400"
          : "border-red-500/30 bg-red-500/10 text-red-400"
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

// ─── Card shell ───────────────────────────────────────────────────────────────

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray-800 bg-gray-900 ${className}`}>
      {children}
    </div>
  );
}

function CardHeader({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5 border-b border-gray-800 px-5 py-4">
      <span className="text-violet-400">{icon}</span>
      <h2 className="text-sm font-semibold text-white">{title}</h2>
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
        className="cursor-help text-gray-500 transition-colors hover:text-gray-300 focus:outline-none focus-visible:text-gray-300"
      >
        <Info className="h-3 w-3" aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-0 z-20 mb-1.5 w-60 rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-[11px] font-normal leading-relaxed text-gray-300 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
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
  uploadStatus: UploadStatus;
  uploadError: string | null;
  // Bulk: report one or more selected files to the parent
  onFilesAdded: (files: File[]) => void;
  onRemove: () => void;
  // Task 1.3: callback to report video duration to parent
  onDurationChange: (duration: number | null) => void;
  // Asset source: report a picked creation's hosted URL to the parent
  onAssetSelected: (mediaUrl: string) => void;
}

function UploadCard({ file, videoUrl, uploadStatus, uploadError, onFilesAdded, onRemove, onDurationChange, onAssetSelected }: UploadCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [tab, setTab] = useState<"upload" | "assets">("upload");
  // Task 2.1: local object URL for instant preview
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ACCEPTED_TYPES = ["video/mp4", "video/quicktime", "video/avi", "video/x-msvideo"];

  // Preview source: a device File's object URL, or — for an asset-backed item
  // with no File — the hosted videoUrl directly. Duration is captured the same
  // way (<video onLoadedMetadata>) in both cases.
  useEffect(() => {
    if (file) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    if (videoUrl) {
      setPreviewUrl(videoUrl);
      return;
    }
    setPreviewUrl(null);
    setDuration(null);
    onDurationChange(null);
  }, [file, videoUrl, onDurationChange]);

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

  // Task 2.3: capture duration from video metadata
  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const d = e.currentTarget.duration;
    const valid = isFinite(d) ? d : null;
    setDuration(valid);
    onDurationChange(valid);
  };

  const dropZoneClass =
    isDragging ? "border-violet-500 bg-violet-500/10" :
    uploadStatus === "done" ? "border-green-500/40 bg-green-500/5" :
    uploadStatus === "error" ? "border-red-500/40 bg-red-500/5" :
    uploadStatus === "uploading" ? "border-violet-500/40 bg-violet-500/5 cursor-not-allowed" :
    "border-gray-700 bg-gray-800/50 hover:border-gray-600 hover:bg-gray-800";

  return (
    <Card>
      <CardHeader title="Upload Video" icon={<FileVideo className="h-4 w-4" />} />
      <div className="p-5">
        <div className="mb-4 inline-flex rounded-lg border border-gray-700 bg-gray-800 p-0.5">
          <button
            type="button"
            onClick={() => setTab("upload")}
            className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "upload" ? "bg-violet-600 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            📁 Upload from device
          </button>
          <button
            type="button"
            onClick={() => setTab("assets")}
            className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              tab === "assets" ? "bg-violet-600 text-white" : "text-gray-400 hover:text-white"
            }`}
          >
            🎬 My Assets
          </button>
        </div>

        {tab === "upload" && (
        <div
          role="button"
          tabIndex={uploadStatus === "uploading" ? -1 : 0}
          aria-label="Drop zone for video upload"
          onClick={() => uploadStatus !== "uploading" && inputRef.current?.click()}
          onKeyDown={(e) => e.key === "Enter" && uploadStatus !== "uploading" && inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-10 text-center transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 ${dropZoneClass}`}
        >
          {uploadStatus === "uploading" && (
            <>
              <RefreshCw className="h-8 w-8 animate-spin text-violet-400" />
              <div>
                <p className="text-sm font-medium text-white">Uploading…</p>
                <p className="mt-0.5 text-xs text-gray-500">{file?.name}</p>
              </div>
              <div className="w-full max-w-xs overflow-hidden rounded-full bg-gray-700">
                <div className="h-1.5 animate-[progress_1.5s_ease-in-out_infinite] rounded-full bg-violet-500" />
              </div>
            </>
          )}
          {uploadStatus === "done" && videoUrl && (
            <>
              <CheckCircle2 className="h-8 w-8 text-green-400" />
              <div>
                <p className="text-sm font-semibold text-green-400">✓ Video ready</p>
                <p className="mt-0.5 text-xs text-gray-400">{file?.name}</p>
                <p className="mt-0.5 text-xs text-gray-500">
                  {file ? `${(file.size / (1024 * 1024)).toFixed(1)} MB` : ""}
                </p>
              </div>
              <button type="button" onClick={handleRemove} className="cursor-pointer rounded-md px-3 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-700 hover:text-white">
                Remove
              </button>
            </>
          )}
          {uploadStatus === "error" && (
            <>
              <AlertCircle className="h-8 w-8 text-red-400" />
              <div>
                <p className="text-sm font-medium text-red-400">Upload failed</p>
                <p className="mt-0.5 text-xs text-gray-500">{uploadError}</p>
              </div>
              <button type="button" onClick={handleRemove} className="cursor-pointer rounded-md px-3 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-700 hover:text-white">
                Try again
              </button>
            </>
          )}
          {uploadStatus === "idle" && (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-800">
                <Upload className="h-5 w-5 text-gray-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">Drop your video here</p>
                <p className="mt-0.5 text-xs text-gray-500">or click to browse</p>
              </div>
            </>
          )}
        </div>
        )}

        {tab === "assets" && (
          <CreationsHistory
            title="Your video assets"
            description="Pick a generated video to schedule — no re-upload needed."
            tools={["reels_seedance", "reels_veo", "storyboard_video"]}
            mediaType="video"
            limit={24}
            selectedUrl={videoUrl}
            onSelect={(item) => onAssetSelected(item.mediaUrl)}
            className="!mt-0 !border-t-0 !pt-0"
          />
        )}

        {/* Task 2.2 & 2.4: video preview + duration */}
        {previewUrl && uploadStatus === "done" && (
          <div className="mt-4 space-y-2">
            <video
              src={previewUrl}
              controls
              onLoadedMetadata={handleLoadedMetadata}
              className="w-full max-h-[200px] rounded-lg border border-gray-700 bg-black"
            />
            {duration !== null && (
              <p className="text-center text-xs text-gray-500">
                Duration: {fmtDuration(duration)}
              </p>
            )}
          </div>
        )}

        <input ref={inputRef} type="file" multiple accept=".mp4,.mov,.avi,video/mp4,video/quicktime,video/avi,video/x-msvideo" onChange={handleChange} className="hidden" aria-label="Video file input" />
        <p className="mt-3 text-center text-xs text-gray-600">Up to 5 videos · Max 60s each · MP4, MOV, AVI · Max 50MB</p>
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
}

function DescriptionCard({ caption, onCaptionChange, title, tags, videoUrl }: DescriptionCardProps) {
  // Reconciled onto the shared useCaptionAI() hook + CaptionControls (task 7.3),
  // removing the duplicated fetch logic. Behavior is preserved: Generate requires
  // a video (Whisper), Polish appears once there's content, and the two-branch
  // usedTranscript warning is rendered by CaptionControls.
  const ai = useCaptionAI();

  // Clear the transcript warning whenever the video changes (removed or replaced)
  useEffect(() => {
    ai.resetWarning();
  }, [videoUrl, ai.resetWarning]);

  const handleGenerate = async () => {
    try {
      const next = await ai.generate({ title, tags, videoUrl });
      onCaptionChange(next);
    } catch {
      // error surfaced by the hook
    }
  };

  const handlePolish = async () => {
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
          <label htmlFor="video-caption" className="mb-1.5 block text-xs font-medium text-gray-400">
            Caption
          </label>
          <textarea
            id="video-caption"
            value={caption}
            onChange={(e) => onCaptionChange(e.target.value)}
            placeholder="Write your caption here, or generate one with AI below..."
            rows={5}
            aria-label="Caption (editable)"
            className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3.5 py-3 text-sm text-white placeholder-gray-600 transition-colors focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
          <p className="mt-1 text-right text-xs text-gray-600">
            {caption.length} / 300 chars
          </p>
        </div>

        <CaptionControls
          ai={ai}
          hasVideo={!!videoUrl}
          hasContent={!!caption.trim()}
          hasTitle={!!title.trim()}
          generateLabel="Generate Caption"
          onGenerate={handleGenerate}
          onPolish={handlePolish}
        />
      </div>
    </Card>
  );
}

// ─── Schedule Card ────────────────────────────────────────────────────────────

interface ScheduleCardProps {
  videoUrl: string | null;
  caption: string;
  onSuccess: () => void;
  onToast: (toast: ToastState) => void;
  // Task 3.1: duration from parent for guard
  videoDuration: number | null;
  // Lifted to page so DescriptionCard can read them for AI prompts
  title: string;
  tags: string;
  onTitleChange: (title: string) => void;
  onTagsChange: (tags: string) => void;
}

function ScheduleCard({
  videoUrl,
  caption,
  onSuccess,
  onToast,
  videoDuration,
  title,
  tags,
  onTitleChange,
  onTagsChange,
}: ScheduleCardProps) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState<ScheduleForm>({ date: today, time: "18:00" });
  const [submitting, setSubmitting] = useState(false);
  const [confirmEmptyCaption, setConfirmEmptyCaption] = useState(false);

  const set = (key: keyof ScheduleForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleBestTime = () => setForm((prev) => ({ ...prev, date: today, time: "18:00" }));

  const resetForm = () => {
    setForm({ date: today, time: "18:00" });
    onTitleChange("");
    onTagsChange("");
    setConfirmEmptyCaption(false);
  };

  const handleSubmit = async () => {
    if (!videoUrl || !title.trim() || !form.date || !form.time) return;

    // Soft, non-blocking warning: empty caption requires one confirming click
    if (!caption.trim() && !confirmEmptyCaption) {
      setConfirmEmptyCaption(true);
      return;
    }

    setSubmitting(true);

    try {
      const scheduled_time = new Date(`${form.date}T${form.time}:00`).toISOString();

      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: videoUrl,
          title: title.trim(),
          description: caption,
          tags,
          scheduled_time,
          platform: "youtube",
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to schedule post.");

      onToast({ type: "success", message: "✓ Post scheduled successfully!" });
      resetForm();
      onSuccess();
    } catch (err) {
      onToast({
        type: "error",
        message: err instanceof Error ? err.message : "Failed to schedule post.",
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Task 3.3: duration guard included in isReady
  const durationOk = videoDuration === null || videoDuration <= 60;
  const isReady = !!videoUrl && !!title.trim() && !!form.date && !!form.time && durationOk;

  return (
    <Card className="sticky top-20">
      <CardHeader title="Schedule Post" icon={<Calendar className="h-4 w-4" />} />

      <div className="space-y-5 p-5">
        {/* Task 3.2: duration warning banner */}
        {videoDuration !== null && videoDuration > 60 && (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-3">
            <AlertCircle className="mt-px h-4 w-4 shrink-0 text-amber-400" />
            <p className="text-xs text-amber-400">
              ⚠️ Video is {Math.round(videoDuration)}s — YouTube Shorts requires under 60s
            </p>
          </div>
        )}

        {/* Platform */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-gray-400">Platform</label>
          <div className="flex items-center gap-2.5 rounded-lg border border-gray-700 bg-gray-800 px-3.5 py-2.5">
            <YoutubeIcon className="h-4 w-4 text-red-400" />
            <span className="flex-1 text-sm text-white">YouTube</span>
            <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-violet-400">Selected</span>
            <ChevronDown className="h-4 w-4 text-gray-600" />
          </div>
          <p className="mt-1 text-xs text-gray-600">More platforms coming soon</p>
        </div>

        {/* Title */}
        <div>
          <label htmlFor="post-title" className="mb-1.5 block text-xs font-medium text-gray-400">
            Title <span className="text-red-400" aria-hidden>*</span>
          </label>
          <input
            id="post-title"
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="My awesome video title"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3.5 py-2.5 text-sm text-white placeholder-gray-600 transition-colors focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>

        {/* Tags */}
        <div>
          <label htmlFor="post-tags" className="mb-1.5 flex items-center gap-1 text-xs font-medium text-gray-400">
            Tags
            <InfoTooltip text={TAGS_TOOLTIP} />
          </label>
          <div className="relative">
            <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
            <input
              id="post-tags"
              type="text"
              value={tags}
              onChange={(e) => onTagsChange(e.target.value)}
              placeholder="tutorial, automation, content"
              className="w-full rounded-lg border border-gray-700 bg-gray-800 py-2.5 pl-9 pr-3.5 text-sm text-white placeholder-gray-600 transition-colors focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
          </div>
          <p className="mt-1 text-xs text-gray-600">Comma-separated</p>
        </div>

        {/* Date & Time */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="schedule-date" className="mb-1.5 block text-xs font-medium text-gray-400">
              <Calendar className="mr-1 inline h-3 w-3" />
              Date <span className="text-red-400" aria-hidden>*</span>
            </label>
            <input id="schedule-date" type="date" value={form.date} min={today} onChange={set("date")}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition-colors focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 [color-scheme:dark]" />
          </div>
          <div>
            <label htmlFor="schedule-time" className="mb-1.5 block text-xs font-medium text-gray-400">
              <Clock className="mr-1 inline h-3 w-3" />
              Time <span className="text-red-400" aria-hidden>*</span>
            </label>
            <input id="schedule-time" type="time" value={form.time} onChange={set("time")}
              className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2.5 text-sm text-white transition-colors focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500 [color-scheme:dark]" />
          </div>
        </div>

        {/* Best Time */}
        <button type="button" onClick={handleBestTime}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm font-medium text-amber-400 transition-all duration-200 hover:border-amber-500/50 hover:bg-amber-500/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500">
          <Zap className="h-4 w-4" />
          Use Best Time · 6:00 PM today
        </button>

        <div className="border-t border-gray-800 pt-1" />

        {/* Soft warning: empty caption — does not block, just confirms */}
        {confirmEmptyCaption && !caption.trim() && (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-3">
            <AlertCircle className="mt-px h-4 w-4 shrink-0 text-amber-400" />
            <p className="text-xs text-amber-400">
              ⚠️ No caption added. Click “Schedule Post” again to publish without one,
              or write a caption above.
            </p>
          </div>
        )}

        {/* Submit */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!isReady || submitting}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition-all duration-200 hover:bg-violet-500 hover:shadow-violet-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {submitting
            ? <><RefreshCw className="h-4 w-4 animate-spin" />Scheduling…</>
            : <><Calendar className="h-4 w-4" />Schedule Post</>}
        </button>

        <p className="text-center text-xs text-gray-600">
          {!videoUrl ? "Upload a video to enable scheduling"
            : videoDuration !== null && videoDuration > 60 ? "Shorten video to under 60s to schedule"
            : !title.trim() ? "Add a title to schedule"
            : ""}
        </p>
      </div>
    </Card>
  );
}

// ─── Recent Posts Card ────────────────────────────────────────────────────────

const STATUS_CFG = {
  scheduled: { label: "Scheduled", badge: "border-blue-500/30 bg-blue-500/10 text-blue-400", dot: "bg-blue-400" },
  published: { label: "Published", badge: "border-green-500/30 bg-green-500/10 text-green-400", dot: "bg-green-400" },
  failed:    { label: "Failed",    badge: "border-red-500/30 bg-red-500/10 text-red-400",     dot: "bg-red-400"   },
  draft:     { label: "Draft",     badge: "border-gray-700 bg-gray-800 text-gray-400",        dot: "bg-gray-500"  },
} as const;

interface RecentPostsCardProps {
  posts: Post[];
  totalCount: number;
  loading: boolean;
  onRetry: (postId: string) => void;
}

function RecentPostsCard({ posts, totalCount, loading, onRetry }: RecentPostsCardProps) {
  return (
    <Card>
      <div className="flex items-center justify-between border-b border-gray-800 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <span className="text-violet-400"><CalendarDays className="h-4 w-4" /></span>
          <h2 className="text-sm font-semibold text-white">Your Recent Posts</h2>
        </div>
        {loading && <RefreshCw className="h-3.5 w-3.5 animate-spin text-gray-600" />}
      </div>

      <div className="divide-y divide-gray-800/60">
        {posts.length === 0 && !loading && (
          <p className="px-5 py-6 text-center text-sm text-gray-600">
            No posts yet. Schedule your first video above.
          </p>
        )}

        {posts.map((post) => {
          const cfg = STATUS_CFG[post.status] ?? STATUS_CFG.draft;
          return (
            <div key={post.id} className="flex items-center gap-3 px-5 py-3.5">
              <div className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${cfg.dot}`} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-white">{post.title}</p>
                <p className="mt-0.5 text-xs text-gray-500">{fmtScheduledTime(post.scheduled_time)}</p>
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
                  className="shrink-0 cursor-pointer rounded-md p-1.5 text-gray-500 transition-colors hover:bg-gray-800 hover:text-red-400"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
              {/* Task 5.6: Retry for failed */}
              {post.status === "failed" && (
                <button
                  type="button"
                  onClick={() => onRetry(post.id)}
                  className="shrink-0 cursor-pointer rounded-md border border-gray-700 px-2.5 py-1 text-xs text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
                >
                  Retry
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Task 5.8: "View all" link if more posts exist */}
      {totalCount > 5 && (
        <div className="border-t border-gray-800 px-5 py-3">
          <Link
            href="/tools/scheduler/calendar"
            className="flex items-center gap-1.5 text-xs text-violet-400 transition-colors hover:text-violet-300"
          >
            View all in Calendar
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}
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
    async (input: { title: string; tags: string; videoUrl: string | null }): Promise<string> => {
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
  hasVideo: boolean;
  hasContent: boolean;
  hasTitle: boolean;
  generateLabel: string;
  onGenerate: () => void;
  onPolish: () => void;
  // Hint shown when there's nothing to generate from yet. `null` hides it
  // (e.g. the shared box renders its own helper text instead).
  emptyHint?: string | null;
}

function CaptionControls({
  ai,
  hasVideo,
  hasContent,
  hasTitle,
  generateLabel,
  onGenerate,
  onPolish,
  emptyHint = "Upload a video first to generate an AI caption",
}: CaptionControlsProps) {
  const isBusy = ai.busy !== null;

  return (
    <div className="space-y-2">
      {hasContent && ai.lastTranscriptStatus === "failed" && (
        <p className="mt-1 text-xs text-amber-400">
          ⚠️ Couldn&apos;t read the audio this time — caption was generated from your title and tags.
          Try generating again.
        </p>
      )}

      {hasContent &&
        ai.lastTranscriptStatus === "no_audio" &&
        (hasTitle ? (
          <p className="mt-1 text-xs text-slate-400">
            🎵 No audio detected — caption was generated from your title and tags.
          </p>
        ) : (
          <p className="mt-1 text-xs text-amber-400">
            ⚠️ No audio detected and no title added. Your caption may not be relevant — try adding a
            title and tags, then regenerate.
          </p>
        ))}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onGenerate}
          disabled={isBusy || !hasVideo}
          className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {ai.busy === "generate" ? (
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
            className="flex flex-1 cursor-pointer items-center justify-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-4 py-2.5 text-sm font-medium text-violet-300 transition-all duration-200 hover:bg-violet-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
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

      {ai.busy && (
        <p className="text-center text-xs text-gray-500">
          {ai.busy === "generate" ? "🎙️ Transcribing & writing…" : "✍️ Polishing your caption…"}
        </p>
      )}

      {!ai.busy && !hasContent && !hasVideo && emptyHint && (
        <p className="text-center text-xs text-gray-600">{emptyHint}</p>
      )}

      {ai.error && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3"
        >
          <AlertCircle className="mt-px h-4 w-4 shrink-0 text-red-400" />
          <div className="flex-1">
            <p className="text-xs font-medium text-red-400">Generation failed</p>
            <p className="mt-0.5 text-xs text-red-400/80">{ai.error}</p>
          </div>
          <button
            type="button"
            onClick={ai.clearError}
            aria-label="Dismiss"
            className="cursor-pointer text-red-400/60 hover:text-red-400"
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
}

function BulkVideoCard({ item, index, captionMode, onUpdate, onRemove }: BulkVideoCardProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const today = new Date().toISOString().split("T")[0];
  const ai = useCaptionAI();

  useEffect(() => {
    if (item.file) {
      const url = URL.createObjectURL(item.file);
      setPreviewUrl(url);
      return () => URL.revokeObjectURL(url);
    }
    // Asset-backed card: preview straight from the hosted URL.
    setPreviewUrl(item.videoUrl);
  }, [item.file, item.videoUrl]);

  // Clear the transcript warning when this card's video changes
  useEffect(() => {
    ai.resetWarning();
  }, [item.videoUrl, ai.resetWarning]);

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const d = e.currentTarget.duration;
    onUpdate({ duration: isFinite(d) ? d : null });
  };

  const handleGenerate = async () => {
    try {
      const caption = await ai.generate({
        title: item.title,
        tags: item.tags,
        videoUrl: item.videoUrl,
      });
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

  const overLimit = item.duration !== null && item.duration > 60;

  return (
    <Card className="p-4">
      <div className="flex flex-col gap-4 sm:flex-row">
        {/* Left: compact thumbnail + meta */}
        <div className="w-full shrink-0 space-y-1.5 sm:w-36">
          {previewUrl ? (
            <video
              src={previewUrl}
              controls
              onLoadedMetadata={handleLoadedMetadata}
              className="max-h-[220px] w-full rounded-lg border border-gray-700 bg-black object-contain sm:max-h-[200px]"
            />
          ) : (
            <div className="flex aspect-[9/16] w-full items-center justify-center rounded-lg border border-gray-700 bg-gray-800/50 sm:max-h-[200px]">
              <FileVideo className="h-6 w-6 text-gray-600" />
            </div>
          )}

          <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500">
            <span className="truncate">{item.file?.name ?? `Video ${index + 1}`}</span>
            {item.duration !== null && (
              <span className={`shrink-0 ${overLimit ? "text-amber-400" : ""}`}>
                {fmtDuration(item.duration)}
              </span>
            )}
          </div>

          {overLimit && (
            <p className="flex items-center gap-1 text-[11px] text-amber-400">
              <AlertCircle className="h-3 w-3 shrink-0" />
              Over 60s — Shorts must be shorter
            </p>
          )}

          {item.uploadStatus === "error" && (
            <p className="text-[11px] text-red-400">{item.uploadError ?? "Upload failed."}</p>
          )}
        </div>

        {/* Right: fields */}
        <div className="min-w-0 flex-1 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">Video {index + 1}</h2>
            <div className="flex items-center gap-2">
              {item.scheduleStatus === "scheduling" ? (
                <span className="flex items-center gap-1 text-xs text-violet-400">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Scheduling…
                </span>
              ) : item.scheduleStatus === "scheduled" ? (
                <span className="rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[11px] font-medium text-green-400">
                  Scheduled ✅
                </span>
              ) : item.scheduleStatus === "failed" ? (
                <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-400">
                  Failed ❌
                </span>
              ) : (
                <>
                  {item.uploadStatus === "uploading" && (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-violet-400" />
                  )}
                  {item.uploadStatus === "done" && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />
                  )}
                  {item.uploadStatus === "error" && (
                    <AlertCircle className="h-3.5 w-3.5 text-red-400" />
                  )}
                </>
              )}
              <button
                type="button"
                onClick={onRemove}
                aria-label={`Remove video ${index + 1}`}
                className="cursor-pointer rounded-md p-1 text-gray-500 transition-colors hover:bg-gray-800 hover:text-red-400"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {item.scheduleStatus === "failed" && item.scheduleError && (
            <p className="flex items-start gap-1 text-xs text-red-400">
              <AlertCircle className="mt-px h-3 w-3 shrink-0" />
              {item.scheduleError}
            </p>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                Title <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={item.title}
                onChange={(e) => onUpdate({ title: e.target.value })}
                placeholder="My awesome video title"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="mb-1 flex items-center gap-1 text-xs font-medium text-gray-400">
                Tags
                <InfoTooltip text={TAGS_TOOLTIP} />
              </label>
              <input
                type="text"
                value={item.tags}
                onChange={(e) => onUpdate({ tags: e.target.value })}
                placeholder="tutorial, automation"
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                <Calendar className="mr-1 inline h-3 w-3" />
                Date <span className="text-red-400">*</span>
              </label>
              <input
                type="date"
                value={item.date}
                min={today}
                onChange={(e) => onUpdate({ date: e.target.value })}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-2 text-sm text-white [color-scheme:dark] focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-400">
                <Clock className="mr-1 inline h-3 w-3" />
                Time <span className="text-red-400">*</span>
              </label>
              <input
                type="time"
                value={item.time}
                onChange={(e) => onUpdate({ time: e.target.value })}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-2.5 py-2 text-sm text-white [color-scheme:dark] focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          </div>

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
              className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <p className="mt-0.5 text-right text-[11px] text-gray-600">
              {item.caption.length} / 300 chars
            </p>
          </div>

          {captionMode === "individual" && (
            <CaptionControls
              ai={ai}
              hasVideo={!!item.videoUrl}
              hasContent={!!item.caption.trim()}
              hasTitle={!!item.title.trim()}
              generateLabel="Generate Caption"
              onGenerate={handleGenerate}
              onPolish={handlePolish}
            />
          )}
        </div>
      </div>
    </Card>
  );
}

// ─── Deep-link intake ─────────────────────────────────────────────────────────

// Reads a `?assetUrl=&title=` hand-off (e.g. from ReelsGen's "Schedule to
// YouTube") and applies it exactly once. Isolated in its own component so the
// `useSearchParams()` call can sit under a <Suspense> boundary as App Router
// requires. The useRef guard makes it StrictMode-safe (effects double-invoke in
// dev) and immune to re-renders.
function DeepLinkIntake({
  onAsset,
}: {
  onAsset: (assetUrl: string, title: string | null) => void;
}) {
  const searchParams = useSearchParams();
  const consumed = useRef(false);

  useEffect(() => {
    if (consumed.current) return;
    const assetUrl = searchParams.get("assetUrl");
    if (!assetUrl) return;
    consumed.current = true;
    onAsset(assetUrl, searchParams.get("title"));
  }, [searchParams, onAsset]);

  return null;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SchedulerDashboardPage() {
  const router = useRouter();
  const today = new Date().toISOString().split("T")[0];
  // Unified state: single mode = one item, bulk mode = 2..5 items.
  // Always holds at least one (empty) draft so the form is editable pre-upload.
  const [items, setItems] = useState<VideoItem[]>(() => [makeDraft(today)]);
  const [toast, setToast] = useState<ToastState | null>(null);
  // Task 5.1: posts state
  const [posts, setPosts] = useState<Post[]>([]);
  const [totalPostCount, setTotalPostCount] = useState(0);
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
  const handleItem0Duration = useCallback(
    (d: number | null) => updateItem(item0Id, { duration: d }),
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
  const noop = useCallback(() => {}, []);

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
      setTotalPostCount(sorted.length);
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
  const handleFilesAdded = useCallback(
    async (files: File[]) => {
      const valid: File[] = [];
      for (const f of files) {
        if (!ACCEPTED_VIDEO_TYPES.includes(f.type)) {
          setToast({ type: "error", message: `"${f.name}" skipped — only MP4, MOV, AVI.` });
          continue;
        }
        if (f.size > MAX_FILE_BYTES) {
          setToast({ type: "error", message: `"${f.name}" skipped — over 50MB.` });
          continue;
        }
        valid.push(f);
      }
      if (valid.length === 0) return;

      const existingReal = items.filter((i) => i.file);
      const slots = MAX_VIDEOS - existingReal.length;
      if (slots <= 0) {
        setToast({ type: "error", message: `Max ${MAX_VIDEOS} videos reached.` });
        return;
      }
      const accepted = valid.slice(0, slots);
      if (valid.length > slots) {
        setToast({ type: "error", message: `Max ${MAX_VIDEOS} videos — extra files were skipped.` });
      }

      const newItems: VideoItem[] = accepted.map((f) => ({
        ...makeDraft(today),
        file: f,
        uploadStatus: "uploading",
      }));

      // Auto-space (Prompt 4): once the batch reaches 2+ videos, lay the NEW
      // cards into 2-per-day slots (12:00 / 18:00), continuing from the existing
      // count and anchored to the first card's date. Existing cards keep their
      // date/time so any manual edits are preserved.
      const willBeBulk = existingReal.length + newItems.length >= 2;
      const anchorDate = (existingReal[0] ?? newItems[0]).date;
      const spacedNew = willBeBulk
        ? newItems.map((it, k) => ({
            ...it,
            ...spacedSlot(anchorDate, existingReal.length + k),
          }))
        : newItems;
      setItems([...existingReal, ...spacedNew]);

      // Sequential uploads — one at a time, updating each item as it resolves.
      // Direct-to-Supabase: the server only mints a tiny signed-URL payload, then
      // the file bytes go browser → Storage via uploadToSignedUrl. This bypasses
      // the serverless request-body limit (~4.5 MB on Vercel) that the old
      // multipart /api/upload POST hit for larger files.
      for (const it of newItems) {
        try {
          const file = it.file as File;

          const signRes = await fetch("/api/upload/sign", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              filename: file.name,
              contentType: file.type,
              size: file.size,
            }),
          });

          // Guard against a non-JSON error body (e.g. an upstream error page) so
          // the user sees a readable message instead of a JSON-parse exception.
          const signData = await signRes.json().catch(() => null);
          if (!signRes.ok || !signData) {
            throw new Error(
              (signData && signData.error) || "Couldn't start the upload. Please try again.",
            );
          }

          const { bucket, path, token, publicUrl } = signData as {
            bucket: string;
            path: string;
            token: string;
            publicUrl: string;
          };

          const { error: uploadError } = await getSupabaseBrowser()
            .storage.from(bucket)
            .uploadToSignedUrl(path, token, file, { contentType: file.type });

          if (uploadError) throw new Error(uploadError.message || "Upload failed.");

          updateItem(it.id, { videoUrl: publicUrl, uploadStatus: "done" });
        } catch (err) {
          updateItem(it.id, {
            uploadStatus: "error",
            uploadError: err instanceof Error ? err.message : "Upload failed.",
          });
        }
      }
    },
    [items, today, updateItem],
  );

  // Pick an existing video creation as a schedulable item — no /api/upload.
  // Fills the first empty draft in place (keeps single mode single); otherwise
  // appends a new card (auto-spaced like uploads) up to MAX_VIDEOS.
  const handleAssetSelected = useCallback(
    (mediaUrl: string) => {
      const assetPatch: Partial<VideoItem> = {
        videoUrl: mediaUrl,
        uploadStatus: "done",
        uploadError: null,
        file: null,
        duration: null,
        scheduleStatus: "idle",
        scheduleError: null,
      };

      // A reusable card is an empty draft OR a card whose device upload failed
      // (it still holds a File but has no hosted URL). Reusing the errored card
      // lets a picked asset recover it in place instead of appending a zombie
      // card and forcing bulk mode. `assetPatch` already clears file/error.
      const reusableIdx = items.findIndex(
        (i) =>
          (!i.file && !i.videoUrl) ||
          (i.uploadStatus === "error" && !i.videoUrl),
      );
      if (reusableIdx !== -1) {
        updateItem(items[reusableIdx].id, assetPatch);
        return;
      }

      if (items.length >= MAX_VIDEOS) {
        setToast({ type: "error", message: `Max ${MAX_VIDEOS} videos reached.` });
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

  // Deep-link hand-off (e.g. ReelsGen → "Schedule to YouTube"). Reuses the
  // asset intake above, then pre-fills the title on the card that now holds the
  // asset (matched by videoUrl — the prior setItems updates are already queued,
  // so this functional update sees the just-added/filled item). Finally strips
  // the query params so a refresh doesn't re-trigger and the URL stays clean.
  const handleDeepLinkAsset = useCallback(
    (assetUrl: string, title: string | null) => {
      handleAssetSelected(assetUrl);
      if (title && title.trim()) {
        setItems((prev) => {
          const idx = prev.findIndex((i) => i.videoUrl === assetUrl);
          if (idx === -1) return prev;
          return prev.map((i, k) => (k === idx ? { ...i, title: title.trim() } : i));
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

  // A card is schedulable when it has a hosted video, a title, a date/time, and
  // (if known) a ≤60s duration — mirrors single-mode ScheduleCard.isReady.
  const itemReady = useCallback(
    (i: VideoItem) =>
      !!i.videoUrl &&
      !!i.title.trim() &&
      !!i.date &&
      !!i.time &&
      (i.duration === null || i.duration <= 60),
    [],
  );

  // Targets = ready cards not already scheduled (so a re-run retries failures too).
  const scheduleTargets = items.filter(
    (i) => itemReady(i) && i.scheduleStatus !== "scheduled",
  );
  const hasScheduled = items.some((i) => i.scheduleStatus === "scheduled");
  const canScheduleAll = scheduleTargets.length > 0 && !schedulingAll;

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
    if (targets.length === 0 || schedulingAll) return;

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

    let success = 0;
    for (const it of targets) {
      try {
        const scheduled_time = new Date(`${it.date}T${it.time}:00`).toISOString();
        const res = await fetch("/api/posts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            video_url: it.videoUrl,
            title: it.title.trim(),
            description: it.caption,
            tags: it.tags,
            scheduled_time,
            platform: "youtube",
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to schedule post.");
        success += 1;
        updateItem(it.id, { scheduleStatus: "scheduled", scheduleError: null });
      } catch (err) {
        updateItem(it.id, {
          scheduleStatus: "failed",
          scheduleError: err instanceof Error ? err.message : "Failed to schedule post.",
        });
      }
    }

    setSchedulingAll(false);
    setToast({
      type: success === targets.length ? "success" : "error",
      message: `${success}/${targets.length} posts scheduled successfully`,
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
    <div className="min-h-screen bg-gray-950">
      <Suspense fallback={null}>
        <DeepLinkIntake onAsset={handleDeepLinkAsset} />
      </Suspense>
      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">Create & Schedule</h1>
            <p className="mt-1 text-sm text-gray-500">
              Upload a video, generate a caption, and publish on autopilot.
            </p>
          </div>
          <YouTubeStatusBadge />
        </div>

        {single ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
            <div className="space-y-6">
              <UploadCard
                file={item0.file}
                videoUrl={item0.videoUrl}
                uploadStatus={item0.uploadStatus}
                uploadError={item0.uploadError}
                onFilesAdded={handleFilesAdded}
                onRemove={handleItem0Remove}
                onDurationChange={handleItem0Duration}
                onAssetSelected={handleAssetSelected}
              />
              <DescriptionCard
                caption={item0.caption}
                onCaptionChange={handleItem0Caption}
                title={item0.title}
                tags={item0.tags}
                videoUrl={item0.videoUrl}
              />
            </div>

            <div>
              <ScheduleCard
                videoUrl={item0.videoUrl}
                caption={item0.caption}
                onSuccess={handleSuccess}
                onToast={setToast}
                videoDuration={item0.duration}
                title={item0.title}
                tags={item0.tags}
                onTitleChange={handleItem0Title}
                onTagsChange={handleItem0Tags}
              />
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <UploadCard
              file={null}
              videoUrl={null}
              uploadStatus="idle"
              uploadError={null}
              onFilesAdded={handleFilesAdded}
              onRemove={noop}
              onDurationChange={noop}
              onAssetSelected={handleAssetSelected}
            />

            <div className="flex items-center gap-3">
              <span className="text-xs font-medium text-gray-400">Caption</span>
              <div className="inline-flex rounded-lg border border-gray-700 bg-gray-800 p-0.5">
                <button
                  type="button"
                  onClick={() => setCaptionMode("individual")}
                  className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    captionMode === "individual"
                      ? "bg-violet-600 text-white"
                      : "text-gray-400 hover:text-white"
                  }`}
                >
                  Individual
                </button>
                <button
                  type="button"
                  onClick={() => setCaptionMode("same")}
                  className={`cursor-pointer rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    captionMode === "same"
                      ? "bg-violet-600 text-white"
                      : "text-gray-400 hover:text-white"
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
                      className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3.5 py-3 text-sm text-white placeholder-gray-600 transition-colors focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
                    />
                    <p className="mt-1 text-right text-xs text-gray-600">
                      {sharedCaption.length} / 300 chars
                    </p>
                  </div>

                  <CaptionControls
                    ai={sharedAi}
                    hasVideo={hasCaptionContext}
                    hasContent={!!sharedCaption.trim()}
                    hasTitle
                    generateLabel="✨ Generate General Caption"
                    onGenerate={handleSharedGenerate}
                    onPolish={handleSharedPolish}
                    emptyHint={null}
                  />

                  <p className="text-xs text-gray-600">
                    {hasCaptionContext
                      ? "Generated from the titles & tags of all your videos (no audio) — one caption that broadly fits the whole batch. Applies to all videos; edit any card below to override."
                      : "Add a title or tags to at least one video to generate a shared caption."}
                  </p>
                </div>
              </Card>
            )}

            <div
              role="status"
              className="flex items-start gap-2.5 rounded-lg border border-sky-500/25 bg-sky-500/10 px-4 py-3"
            >
              <Info className="mt-px h-4 w-4 shrink-0 text-sky-400" />
              <p className="text-xs text-sky-300">
                Videos are spread across days for optimal reach (max 2/day at 12:00 &amp; 18:00).
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
                />
              ))}
            </div>

            <div className="space-y-2">
              {confirmEmptyBatch && (
                <div
                  role="alert"
                  className="flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-3"
                >
                  <AlertCircle className="mt-px h-4 w-4 shrink-0 text-amber-400" />
                  <p className="text-xs text-amber-400">
                    ⚠️ Some videos have no caption. Click “Schedule All” again to publish them
                    without a caption, or add captions above.
                  </p>
                </div>
              )}

              <button
                type="button"
                onClick={handleScheduleAll}
                disabled={!canScheduleAll}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-900/30 transition-all duration-200 hover:bg-violet-500 hover:shadow-violet-900/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
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

              {hasScheduled && !schedulingAll && (
                <button
                  type="button"
                  onClick={clearScheduledItems}
                  className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border border-gray-700 px-4 py-2.5 text-sm font-medium text-gray-400 transition-colors hover:border-gray-600 hover:text-white"
                >
                  Clear scheduled & keep editing
                </button>
              )}

              <p className="text-center text-xs text-gray-600">
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
            totalCount={totalPostCount}
            loading={postsLoading}
            onRetry={handleRetry}
          />
        </div>
      </main>

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
