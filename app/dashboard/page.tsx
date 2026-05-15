"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import Image from "next/image";
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
  LayoutDashboard,
  CalendarDays,
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
  title: string;
  tags: string;
  date: string;
  time: string;
}

interface ToastState {
  type: "success" | "error";
  message: string;
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

// ─── Navbar ───────────────────────────────────────────────────────────────────

function Navbar() {
  const { data: session, status } = useSession();
  const isLoading = status === "loading";
  const isConnected = status === "authenticated";

  return (
    <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-gray-800 bg-gray-950/80 px-6 backdrop-blur-md">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600">
            <Zap className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-semibold tracking-tight text-white">Autopilot Scheduler</span>
        </div>

        <nav className="flex items-center gap-1">
          <Link
            href="/dashboard"
            className="flex items-center gap-1.5 rounded-md bg-gray-800 px-3 py-1.5 text-sm font-medium text-white"
            aria-current="page"
          >
            <LayoutDashboard className="h-3.5 w-3.5" />
            Dashboard
          </Link>
          <Link
            href="/calendar"
            className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-gray-400 transition-colors hover:bg-gray-800 hover:text-white"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            Calendar
          </Link>
        </nav>
      </div>

      {isLoading ? (
        <div className="h-9 w-44 animate-pulse rounded-lg bg-gray-800" />
      ) : isConnected ? (
        <div className="flex items-center gap-2.5 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-1.5">
          {session.user?.image ? (
            <Image
              src={session.user.image}
              alt={session.user.name ?? "Profile"}
              width={24}
              height={24}
              className="rounded-full"
            />
          ) : (
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-500/30">
              <YoutubeIcon className="h-3.5 w-3.5 text-green-400" />
            </div>
          )}
          <span className="text-sm font-medium text-green-400">YouTube Connected ✓</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm font-medium text-red-400 transition-all duration-200 hover:border-red-500/60 hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
          aria-label="Connect YouTube account"
        >
          <YoutubeIcon className="h-4 w-4" />
          Connect YouTube
        </button>
      )}
    </header>
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

// ─── Upload Card ──────────────────────────────────────────────────────────────

interface UploadCardProps {
  file: File | null;
  videoUrl: string | null;
  uploadStatus: UploadStatus;
  uploadError: string | null;
  onFileSelect: (file: File | null) => void;
}

function UploadCard({ file, videoUrl, uploadStatus, uploadError, onFileSelect }: UploadCardProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = e.dataTransfer.files[0];
      const ACCEPTED = ["video/mp4", "video/quicktime", "video/x-msvideo"];
      if (dropped && ACCEPTED.includes(dropped.type)) onFileSelect(dropped);
    },
    [onFileSelect],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) onFileSelect(selected);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    onFileSelect(null);
    if (inputRef.current) inputRef.current.value = "";
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

        <input ref={inputRef} type="file" accept=".mp4,.mov,.avi,video/mp4,video/quicktime,video/x-msvideo" onChange={handleChange} className="hidden" aria-label="Video file input" />
        <p className="mt-3 text-center text-xs text-gray-600">Max 60 seconds · MP4, MOV, AVI · Max 50MB</p>
      </div>
    </Card>
  );
}

// ─── Description Card ─────────────────────────────────────────────────────────

interface DescriptionCardProps {
  caption: string;
  onCaptionChange: (caption: string) => void;
}

function DescriptionCard({ caption, onCaptionChange }: DescriptionCardProps) {
  const [description, setDescription] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const callAPI = async (): Promise<string> => {
    const res = await fetch("/api/generate-caption", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ description }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
    return data.caption as string;
  };

  const runGenerate = async () => {
    setIsGenerating(true);
    setError(null);
    try { onCaptionChange(await callAPI()); }
    catch (err) { setError(err instanceof Error ? err.message : "Something went wrong."); }
    finally { setIsGenerating(false); }
  };

  return (
    <Card>
      <CardHeader title="Video Description" icon={<Sparkles className="h-4 w-4" />} />
      <div className="space-y-4 p-5">
        <div>
          <label htmlFor="video-description" className="mb-1.5 block text-xs font-medium text-gray-400">
            Describe your video
          </label>
          <textarea
            id="video-description"
            value={description}
            onChange={(e) => { setDescription(e.target.value); if (error) setError(null); }}
            placeholder="e.g. Tutorial on how to schedule 30 days of social media content using automation tools..."
            rows={4}
            className="w-full resize-none rounded-lg border border-gray-700 bg-gray-800 px-3.5 py-3 text-sm text-white placeholder-gray-600 transition-colors focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>

        <button
          type="button"
          onClick={runGenerate}
          disabled={isGenerating || !description.trim()}
          className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition-all duration-200 hover:bg-violet-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isGenerating
            ? <><RefreshCw className="h-4 w-4 animate-spin" />Generating…</>
            : <><Sparkles className="h-4 w-4" />Generate Caption with AI</>}
        </button>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-3.5 py-3">
            <AlertCircle className="mt-px h-4 w-4 shrink-0 text-red-400" />
            <div className="flex-1">
              <p className="text-xs font-medium text-red-400">Generation failed</p>
              <p className="mt-0.5 text-xs text-red-400/80">{error}</p>
            </div>
            <button type="button" onClick={() => setError(null)} aria-label="Dismiss" className="cursor-pointer text-red-400/60 hover:text-red-400">✕</button>
          </div>
        )}

        {(caption || isGenerating) && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-gray-400">Generated Caption</span>
              <button
                type="button"
                onClick={runGenerate}
                disabled={isGenerating}
                aria-label="Refresh caption"
                className="flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-400 transition-colors hover:bg-gray-800 hover:text-white disabled:opacity-40"
              >
                <RefreshCw className={`h-3 w-3 ${isGenerating ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
            <textarea
              value={caption}
              onChange={(e) => onCaptionChange(e.target.value)}
              rows={4}
              placeholder={isGenerating ? "AI is writing your caption…" : ""}
              aria-label="Generated caption (editable)"
              className="w-full resize-none rounded-lg border border-violet-500/30 bg-violet-500/5 px-3.5 py-3 text-sm text-gray-200 placeholder-gray-600 focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
            />
            <p className="text-right text-xs text-gray-600">{caption.length} / 200 chars · editable</p>
          </div>
        )}
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
}

function ScheduleCard({ videoUrl, caption, onSuccess, onToast }: ScheduleCardProps) {
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState<ScheduleForm>({ title: "", tags: "", date: today, time: "18:00" });
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof ScheduleForm) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const handleBestTime = () => setForm((prev) => ({ ...prev, date: today, time: "18:00" }));

  const resetForm = () => setForm({ title: "", tags: "", date: today, time: "18:00" });

  const handleSubmit = async () => {
    if (!videoUrl || !form.title.trim() || !form.date || !form.time) return;
    setSubmitting(true);

    try {
      const scheduled_time = new Date(`${form.date}T${form.time}:00`).toISOString();

      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          video_url: videoUrl,
          title: form.title.trim(),
          description: caption,
          tags: form.tags,
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

  const isReady = !!videoUrl && form.title.trim() && form.date && form.time;

  return (
    <Card className="sticky top-20">
      <CardHeader title="Schedule Post" icon={<Calendar className="h-4 w-4" />} />

      <div className="space-y-5 p-5">
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
            value={form.title}
            onChange={set("title")}
            placeholder="My awesome video title"
            className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3.5 py-2.5 text-sm text-white placeholder-gray-600 transition-colors focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500"
          />
        </div>

        {/* Tags */}
        <div>
          <label htmlFor="post-tags" className="mb-1.5 block text-xs font-medium text-gray-400">Tags</label>
          <div className="relative">
            <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" />
            <input
              id="post-tags"
              type="text"
              value={form.tags}
              onChange={set("tags")}
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
            : !form.title.trim() ? "Add a title to schedule"
            : ""}
        </p>
      </div>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [file, setFile] = useState<File | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);

  const MAX_FILE_BYTES = 50 * 1024 * 1024; // 50 MB

  const handleFileSelect = useCallback(async (selected: File | null) => {
    setFile(selected);
    setVideoUrl(null);
    setUploadError(null);

    if (!selected) { setUploadStatus("idle"); return; }

    if (selected.size > MAX_FILE_BYTES) {
      setUploadStatus("error");
      setUploadError("File too large. Maximum size is 50MB.");
      return;
    }

    setUploadStatus("uploading");
    try {
      const formData = new FormData();
      formData.append("file", selected);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed.");
      setVideoUrl(data.url as string);
      setUploadStatus("done");
    } catch (err) {
      setUploadStatus("error");
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    }
  }, []);

  // Reset everything after a successful schedule
  const handleSuccess = useCallback(() => {
    setFile(null);
    setVideoUrl(null);
    setUploadStatus("idle");
    setUploadError(null);
    setCaption("");
  }, []);

  return (
    <div className="min-h-screen bg-gray-950">
      <Navbar />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white">Create & Schedule</h1>
          <p className="mt-1 text-sm text-gray-500">
            Upload a video, generate a caption, and publish on autopilot.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
          <div className="space-y-6">
            <UploadCard
              file={file}
              videoUrl={videoUrl}
              uploadStatus={uploadStatus}
              uploadError={uploadError}
              onFileSelect={handleFileSelect}
            />
            <DescriptionCard caption={caption} onCaptionChange={setCaption} />
          </div>

          <div>
            <ScheduleCard
              videoUrl={videoUrl}
              caption={caption}
              onSuccess={handleSuccess}
              onToast={setToast}
            />
          </div>
        </div>
      </main>

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}
