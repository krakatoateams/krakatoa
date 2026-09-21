"use client";

// ── PROTOTYPE — throwaway UX exploration, not real code ────────────────────
// Question this answers: instead of today's Scheduler (drop media → pick
// platforms → silently truncate whatever a platform can't fit at submit
// time), what does it feel like if each platform's own limit is visible,
// live, the moment it applies?
//
// Revised after first-round feedback: the first version BLOCKED selecting a
// platform (or dropping more media) once a limit would be exceeded. Real
// reaction to that: too restrictive — only a genuine capability mismatch
// (YouTube + photos) should ever block anything; a platform that just has a
// SMALLER carousel max (Instagram's 10 vs TikTok's 35) should stay
// selectable, with the truncation surfaced as persistent info, not a wall.
//
// No real upload, no Supabase, no scheduling. Media is staged as local
// object URLs only. This file intentionally does NOT import anything from
// SchedulerPageClient.tsx — it's a clean-room UI experiment, not a shared
// component.

import { useCallback, useRef, useState } from "react";
import {
  Upload,
  X,
  Music2,
  ImageIcon,
  Video,
  AlertTriangle,
  CheckCircle2,
  Scissors,
} from "lucide-react";
import PageContainer from "../../dashboard/PageContainer";
import PageHeader from "../../dashboard/PageHeader";

type PlatformKey = "youtube" | "tiktok" | "instagram";

interface PlatformRule {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  supportsPhoto: boolean;
  supportsVideo: boolean;
  maxCarouselPhotos: number;
}

const PLATFORM_RULES: Record<PlatformKey, PlatformRule> = {
  youtube: {
    label: "YouTube",
    icon: Video,
    color: "text-red-400",
    supportsPhoto: false,
    supportsVideo: true,
    maxCarouselPhotos: 0,
  },
  tiktok: {
    label: "TikTok",
    icon: Music2,
    color: "text-pink-400",
    supportsPhoto: true,
    supportsVideo: true,
    maxCarouselPhotos: 35,
  },
  instagram: {
    label: "Instagram",
    icon: ImageIcon,
    color: "text-fuchsia-400",
    supportsPhoto: true,
    supportsVideo: true,
    maxCarouselPhotos: 10,
  },
};

// The dropzone's one hard ceiling — no real platform can use more than this,
// so it's a genuine technical limit, not a platform-selection judgment call.
// Per-platform truncation below this is informational only (see feedback
// above) — the dropzone itself never reactively shrinks based on which
// platforms happen to be checked.
const MAX_TECHNICAL_CEILING = Math.max(...Object.values(PLATFORM_RULES).map((r) => r.maxCarouselPhotos));

// Real app constraint (SchedulerPageClient.tsx's MAX_VIDEOS) — bulk mode
// caps at 5 separate items total. "Split into separate posts" on a carousel
// bigger than this can't actually happen without exceeding that cap.
const MAX_SEPARATE_POSTS = 5;

interface StagedFile {
  id: string;
  url: string;
  kind: "photo" | "video";
  name: string;
}

export default function SchedulerPrototypeClient() {
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [platforms, setPlatforms] = useState<Set<PlatformKey>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const photoFiles = files.filter((f) => f.kind === "photo");
  const videoFile = files.find((f) => f.kind === "video");
  const hasVideo = !!videoFile;
  const hasPhotos = photoFiles.length > 0;

  // Dropzone always accepts up to the one technical ceiling — no reactive
  // shrinking based on platform selection (see revision note up top).
  const activeCap = MAX_TECHNICAL_CEILING;

  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  };

  const addFiles = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const incoming = Array.from(list);
      const incomingKind: "photo" | "video" = incoming[0].type.startsWith("video/") ? "video" : "photo";

      if (incomingKind === "video") {
        if (hasPhotos) {
          showToast("This post already has photos — drop a video into a new post instead.");
          return;
        }
        const file = incoming[0];
        setFiles([{ id: crypto.randomUUID(), url: URL.createObjectURL(file), kind: "video", name: file.name }]);
        return;
      }

      if (hasVideo) {
        showToast("This post already has a video — drop photos into a new post instead.");
        return;
      }

      const photosOnly = incoming.filter((f) => f.type.startsWith("image/"));
      const roomLeft = activeCap - photoFiles.length;
      const accepted = photosOnly.slice(0, Math.max(0, roomLeft));
      const rejected = photosOnly.length - accepted.length;

      if (accepted.length > 0) {
        setFiles((prev) => [
          ...prev,
          ...accepted.map((file) => ({
            id: crypto.randomUUID(),
            url: URL.createObjectURL(file),
            kind: "photo" as const,
            name: file.name,
          })),
        ]);
      }
      if (rejected > 0) {
        showToast(`Only added ${accepted.length} — no platform supports more than ${activeCap} photos in one carousel.`);
      }
    },
    [hasPhotos, hasVideo, photoFiles.length, activeCap],
  );

  const removeFile = (id: string) => setFiles((prev) => prev.filter((f) => f.id !== id));

  // Only a genuine capability mismatch (photos staged + a video-only
  // platform) makes a platform unselectable at all — the checkbox itself is
  // `disabled` below for that case, so this never needs to reject a toggle.
  // A platform whose carousel max is just smaller than the staged count
  // stays freely selectable; the mismatch is shown as persistent info
  // instead (see the "What will publish" section and each platform's own
  // row below).
  const togglePlatform = (key: PlatformKey) => {
    setPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const splitIntoSeparatePosts = () => {
    if (photoFiles.length > MAX_SEPARATE_POSTS) {
      showToast(
        `Can't split into ${photoFiles.length} separate posts — bulk mode allows at most ${MAX_SEPARATE_POSTS} at once. Remove ${photoFiles.length - MAX_SEPARATE_POSTS} photo(s) first, or keep this as one carousel.`,
      );
      return;
    }
    showToast(`Would create ${photoFiles.length} separate posts, one photo each. (Prototype — not wired up.)`);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Scheduler — UX Prototype"
        description="Throwaway exploration, not the real tool. Testing: platform-aware, reactive media limits instead of silent truncation at submit time."
      />

      {toast && (
        <div className="mb-4 flex items-center gap-2.5 rounded-radius-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {toast}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* ── Upload / staged media ── */}
        <div className="rounded-xl bg-white/[0.04] p-5">
          <h2 className="mb-3 text-sm font-semibold text-N900">Upload Media</h2>

          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />

          {files.length === 0 ? (
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/15 bg-white/5 py-14 text-text-secondary transition-colors hover:border-white/30 hover:bg-white/10"
            >
              <Upload className="h-6 w-6" />
              <span className="text-sm font-medium">Drop photos or a video, or click to browse</span>
              <span className="text-xs text-text-disabled">
                Accepts up to {MAX_TECHNICAL_CEILING} photos or 1 video — which platforms can use how many is shown once
                you pick platforms
              </span>
            </button>
          ) : (
            <div>
              {hasVideo ? (
                <div className="relative w-full max-w-xs overflow-hidden rounded-lg border border-white/10 bg-black">
                  <video src={videoFile!.url} controls className="w-full" />
                  <button
                    type="button"
                    onClick={() => removeFile(videoFile!.id)}
                    className="absolute right-2 top-2 rounded-full bg-black/70 p-1 text-white hover:bg-black/90"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <p className="text-xs text-text-secondary">
                      {photoFiles.length}/{activeCap} photos staged
                      {photoFiles.length > 1 && ` · will post as ONE carousel`}
                    </p>
                    {photoFiles.length > 1 && (
                      <button
                        type="button"
                        onClick={splitIntoSeparatePosts}
                        disabled={photoFiles.length > MAX_SEPARATE_POSTS}
                        title={
                          photoFiles.length > MAX_SEPARATE_POSTS
                            ? `Can't split — that would need ${photoFiles.length} separate posts, bulk mode allows at most ${MAX_SEPARATE_POSTS}`
                            : undefined
                        }
                        className="flex items-center gap-1 text-xs font-medium text-text-secondary underline decoration-dotted hover:text-text-primary disabled:cursor-not-allowed disabled:text-text-disabled disabled:no-underline"
                      >
                        <Scissors className="h-3 w-3" />
                        Split into separate posts
                      </button>
                    )}
                  </div>
                  {photoFiles.length > MAX_SEPARATE_POSTS && (
                    <p className="mb-2 flex items-center gap-1 text-xs text-text-disabled">
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      Can&apos;t split into {photoFiles.length} posts — bulk mode allows at most {MAX_SEPARATE_POSTS} at once
                    </p>
                  )}
                  <div className="grid grid-cols-4 gap-2">
                    {photoFiles.map((f) => (
                      <div key={f.id} className="group relative aspect-square overflow-hidden rounded-lg border border-white/10 bg-black">
                        {/* Local blob URL preview only — next/image doesn't apply here. */}
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={f.url} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          onClick={() => removeFile(f.id)}
                          className="absolute right-1 top-1 rounded-full bg-black/70 p-0.5 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {photoFiles.length < activeCap && (
                      <button
                        type="button"
                        onClick={() => inputRef.current?.click()}
                        className="flex aspect-square items-center justify-center rounded-lg border-2 border-dashed border-white/15 text-text-disabled hover:border-white/30 hover:text-text-secondary"
                      >
                        <Upload className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Platform selection ── */}
        <div className="rounded-xl bg-white/[0.04] p-5">
          <h2 className="mb-3 text-sm font-semibold text-N900">Platform</h2>
          <div className="space-y-2.5">
            {(Object.keys(PLATFORM_RULES) as PlatformKey[]).map((key) => {
              const rule = PLATFORM_RULES[key];
              const Icon = rule.icon;
              const selected = platforms.has(key);
              // Genuine capability mismatch — the ONLY thing that disables
              // the checkbox itself. A smaller carousel max is never a
              // mismatch, just a smaller number (see willTruncate below).
              const incompatible = hasPhotos && !rule.supportsPhoto;
              // Informational only — shown regardless of whether this
              // platform is currently checked, so the truncation is visible
              // BEFORE you commit to selecting it, not just after.
              const willTruncate = hasPhotos && rule.supportsPhoto && photoFiles.length > rule.maxCarouselPhotos;

              return (
                <label
                  key={key}
                  className={`flex items-start gap-3 rounded-xl border px-3.5 py-3 transition-colors ${
                    incompatible
                      ? "cursor-not-allowed border-white/10 bg-white/[0.02] opacity-60"
                      : selected
                        ? "cursor-pointer border-white/30 bg-white/10"
                        : "cursor-pointer border-white/10 bg-white/5 hover:border-white/20"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={incompatible}
                    onChange={() => togglePlatform(key)}
                    className="mt-0.5 h-3.5 w-3.5 rounded border-white/10 bg-white/10 text-N900 focus:ring-white/30 disabled:cursor-not-allowed"
                  />
                  <div className="min-w-0 flex-1">
                    <div className={`flex items-center gap-1.5 text-sm font-medium ${incompatible ? "text-text-disabled" : "text-N900"}`}>
                      <Icon className={`h-4 w-4 ${incompatible ? "text-text-disabled" : rule.color}`} />
                      {rule.label}
                    </div>
                    <p className="mt-0.5 text-xs text-text-disabled">
                      {rule.supportsPhoto
                        ? `Photos (carousel, up to ${rule.maxCarouselPhotos}) or 1 video`
                        : `Video only — multiple videos become separate posts`}
                    </p>
                    {/* Always visible while the mismatch is true, not just an
                        error-on-click — persistent, not blocking. */}
                    {incompatible && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-text-disabled">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Doesn&apos;t support photo posts
                      </p>
                    )}
                    {willTruncate && (
                      <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                        <AlertTriangle className="h-3 w-3 shrink-0" />
                        Will only post the first {rule.maxCarouselPhotos} of {photoFiles.length} photos
                      </p>
                    )}
                  </div>
                </label>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Live "what will actually publish" preview ── */}
      {platforms.size > 0 && files.length > 0 && (
        <div className="mt-6 rounded-xl border border-white/10 bg-white/[0.04] p-5">
          <h2 className="mb-3 text-sm font-semibold text-N900">What will publish</h2>
          <div className="space-y-2">
            {[...platforms].map((key) => {
              const rule = PLATFORM_RULES[key];
              const Icon = rule.icon;
              const willSend = hasVideo ? 1 : Math.min(photoFiles.length, rule.maxCarouselPhotos);
              return (
                <div key={key} className="flex items-center gap-2 text-sm text-text-secondary">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                  <Icon className={`h-4 w-4 shrink-0 ${rule.color}`} />
                  <span className="font-medium text-N900">{rule.label}:</span>
                  {hasVideo ? (
                    <span>1 video post</span>
                  ) : photoFiles.length > 1 ? (
                    <span>{willSend}-photo carousel{willSend < photoFiles.length ? ` (of ${photoFiles.length} staged)` : ""}</span>
                  ) : (
                    <span>1 photo post</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        disabled={files.length === 0 || platforms.size === 0}
        onClick={() => showToast("This is a prototype — nothing actually schedules.")}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-radius-xl bg-bg-static-white px-4 py-3 text-sm font-semibold text-text-static-black transition-all hover:bg-N800 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Schedule Post (mock)
      </button>
    </PageContainer>
  );
}
