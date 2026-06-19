"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  Wand2,
  Loader2,
  AlertCircle,
  Check,
  ChevronDown,
  Layers,
  Cpu,
  Crop,
  Maximize2,
  Clock,
  Volume2,
  VolumeX,
  Music,
  Film,
  ImageIcon,
  X,
  Sparkles,
} from "lucide-react";
import CreationsHistory from "@/components/CreationsHistory";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import {
  VIDEO_MODELS,
  getVideoModel,
  validateVideoReferences,
  type VideoModelId,
  type VideoResolution,
  type VideoAspectRatio,
} from "@/lib/video-models";

// One fresh idempotency key per submit (sent as the Idempotency-Key header).
function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

function describeIdempotencyError(
  status: number,
  data: { code?: string; error?: string }
): string | null {
  if (status === 409 && data?.code === "GENERATION_IN_PROGRESS") {
    return "Generation already in progress, please wait.";
  }
  if (status === 409 && data?.code === "IDEMPOTENCY_CONFLICT") {
    return data?.error || "This request conflicts with a previous one.";
  }
  if (status === 400 && data?.code === "IDEMPOTENCY_KEY_REQUIRED") {
    return data?.error || "Missing idempotency key. Please retry.";
  }
  return null;
}

// Creation types in the top-left chip. Only "text2video" is wired here; the other
// two deep-link to the existing /tools/reels page until they are ported over.
const CREATION_TYPES = [
  { id: "text2video", label: "Text to Video", available: true },
  { id: "storyboard", label: "Storyboard to Video", available: false, href: "/tools/reels" },
  { id: "reels-creator", label: "Reels Creator", available: false, href: "/tools/reels" },
] as const;

const ASPECT_RATIO_LABELS: Record<VideoAspectRatio, string> = {
  "16:9": "16:9",
  "4:3": "4:3",
  "1:1": "1:1",
  "3:4": "3:4",
  "9:16": "9:16",
  "21:9": "21:9",
  "9:21": "9:21",
  adaptive: "Adaptive",
};

type ChipOption = { id: string; label: string; hint?: string };

function ChipDropdown({
  icon,
  value,
  options,
  activeId,
  onSelect,
  disabled,
  square = false,
  showChevron = true,
}: {
  icon: React.ReactNode;
  value: string;
  options: ChipOption[];
  activeId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  square?: boolean;
  showChevron?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-10 items-center gap-2 border px-3 text-sm transition-colors disabled:opacity-40 ${
          square ? "rounded-[4px]" : "rounded-full"
        } ${
          open
            ? "border-purple-400/50 bg-purple-500/15 text-white"
            : "border-white/10 bg-white/5 text-gray-200 hover:border-white/25"
        }`}
      >
        <span className="text-purple-300">{icon}</span>
        <span className="font-semibold">{value}</span>
        {showChevron && (
          <ChevronDown
            className={`h-3.5 w-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-white/10 bg-[#0b1020] p-1.5 shadow-2xl shadow-black/50">
          {options.map((opt) => {
            const active = opt.id === activeId;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => {
                  onSelect(opt.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors ${
                  active ? "bg-purple-500/20 text-white" : "text-gray-300 hover:bg-white/5"
                }`}
              >
                <span className="flex items-center gap-2">
                  {opt.label}
                  {opt.hint && (
                    <span className="text-xs font-medium text-purple-300">{opt.hint}</span>
                  )}
                </span>
                {active && <Check className="h-4 w-4 shrink-0 text-purple-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

type RefKind = "image" | "video" | "audio";
type RefStatus = "uploading" | "done" | "error";

type MediaRef = {
  id: string;
  file: File;
  preview: string | null;
  kind: RefKind;
  status: RefStatus;
  url?: string;
  path?: string;
  error?: string;
};

// Mint a signed upload URL and push the bytes straight to Supabase (videos/temp/refs/).
async function uploadRefFile(file: File): Promise<{ url: string; path: string }> {
  const signRes = await fetch("/api/upload/ref/sign", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
    }),
  });
  const signData = await signRes.json().catch(() => null);
  if (!signRes.ok || !signData) {
    throw new Error(signData?.error || "Couldn't start the upload (server error).");
  }
  const { bucket, path, token, publicUrl } = signData as {
    bucket: string;
    path: string;
    token: string;
    publicUrl: string;
  };
  const { error } = await getSupabaseBrowser()
    .storage.from(bucket)
    .uploadToSignedUrl(path, token, file, { contentType: file.type });
  if (error) throw new Error(error.message || "Upload failed.");
  return { url: publicUrl, path };
}

type RefGroupApi = {
  items: MediaRef[];
  add: (files: FileList | File[]) => void;
  remove: (id: string) => void;
  reset: () => void;
  max: number;
  /** at least one item still uploading */
  uploading: boolean;
  /** done items as { url, path } */
  done: { url: string; path: string }[];
};

// Manages a list of media references (auto-uploads on add, dedupes uploads in a
// strict-mode-safe effect, and revokes object URLs on remove/unmount).
function useMediaRefs(kind: RefKind, max: number): RefGroupApi {
  const [items, setItems] = useState<MediaRef[]>([]);
  const startedRef = useRef<Set<string>>(new Set());
  const itemsRef = useRef<MediaRef[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((it) => {
        if (it.preview) URL.revokeObjectURL(it.preview);
      });
    };
  }, []);

  // Kick off uploads for any freshly-added item (deduped by id).
  useEffect(() => {
    for (const it of items) {
      if (it.status === "uploading" && !startedRef.current.has(it.id)) {
        startedRef.current.add(it.id);
        uploadRefFile(it.file)
          .then(({ url, path }) =>
            setItems((cur) =>
              cur.map((x) => (x.id === it.id ? { ...x, status: "done", url, path } : x))
            )
          )
          .catch((e) =>
            setItems((cur) =>
              cur.map((x) =>
                x.id === it.id
                  ? {
                      ...x,
                      status: "error",
                      error: e instanceof Error ? e.message : "Upload failed.",
                    }
                  : x
              )
            )
          );
      }
    }
  }, [items]);

  const add = useCallback(
    (files: FileList | File[]) => {
      const list = Array.from(files);
      setItems((prev) => {
        const room = Math.max(0, max - prev.length);
        const accepted: MediaRef[] = list.slice(0, room).map((file) => ({
          id: crypto.randomUUID(),
          file,
          preview: kind === "audio" ? null : URL.createObjectURL(file),
          kind,
          status: "uploading" as const,
        }));
        return [...prev, ...accepted];
      });
    },
    [kind, max]
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => {
      const target = prev.find((x) => x.id === id);
      if (target?.preview) URL.revokeObjectURL(target.preview);
      return prev.filter((x) => x.id !== id);
    });
  }, []);

  const reset = useCallback(() => {
    setItems((prev) => {
      prev.forEach((x) => {
        if (x.preview) URL.revokeObjectURL(x.preview);
      });
      return [];
    });
  }, []);

  const uploading = items.some((x) => x.status === "uploading");
  const done = items
    .filter((x) => x.status === "done" && x.url)
    .map((x) => ({ url: x.url as string, path: x.path ?? "" }));

  return { items, add, remove, reset, max, uploading, done };
}

function RefTile({ item, onRemove }: { item: MediaRef; onRemove: () => void }) {
  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-[4px] border border-white/10 bg-white/5">
      {item.kind === "image" && item.preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.preview} alt="reference" className="absolute inset-0 h-full w-full object-cover" />
      ) : item.kind === "video" && item.preview ? (
        <video src={item.preview} muted playsInline className="absolute inset-0 h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-gray-400">
          <Music className="h-5 w-5" />
          <span className="max-w-full truncate px-1 text-[8px]">{item.file.name}</span>
        </div>
      )}

      {item.status === "uploading" && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60">
          <Loader2 className="h-5 w-5 animate-spin text-purple-300" />
        </div>
      )}
      {item.status === "error" && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-red-900/60"
          title={item.error || "Upload failed"}
        >
          <AlertCircle className="h-5 w-5 text-red-300" />
        </div>
      )}

      <span
        role="button"
        tabIndex={0}
        onClick={onRemove}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onRemove();
        }}
        className="absolute right-1 top-1 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white hover:bg-red-500/80"
      >
        <X className="h-3 w-3" />
      </span>
    </div>
  );
}

function RefGroup({
  icon,
  label,
  hint,
  accept,
  multiple,
  group,
  disabled,
  disabledReason,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  accept: string;
  multiple: boolean;
  group: RefGroupApi;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const full = group.items.length >= group.max;
  const addDisabled = disabled || full;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          <span className="text-purple-300">{icon}</span>
          {label}
        </span>
        <span className="text-[10px] text-gray-600">
          {group.items.length}/{group.max}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {group.items.map((it) => (
          <RefTile key={it.id} item={it} onRemove={() => group.remove(it.id)} />
        ))}
        {!full && (
          <button
            type="button"
            disabled={addDisabled}
            onClick={() => inputRef.current?.click()}
            title={disabled ? disabledReason : `Add ${label.toLowerCase()}`}
            className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-[4px] border border-dashed border-white/15 bg-white/5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 transition-colors hover:border-purple-400/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
          >
            <Plus className="h-4 w-4" />
            <span>Add</span>
          </button>
        )}
      </div>

      {disabled && disabledReason ? (
        <p className="mt-2 text-[10px] text-amber-300/70">{disabledReason}</p>
      ) : hint ? (
        <p className="mt-2 text-[10px] text-gray-600">{hint}</p>
      ) : null}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) group.add(e.target.files);
          if (inputRef.current) inputRef.current.value = "";
        }}
      />
    </div>
  );
}

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm";
const AUDIO_ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/webm";

export default function VideoOmniPage() {
  const router = useRouter();

  const [modelId, setModelId] = useState<VideoModelId>(VIDEO_MODELS[0].id);
  const model = getVideoModel(modelId);

  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<number>(model.defaultDuration);
  const [resolution, setResolution] = useState<VideoResolution>(model.defaultResolution);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>(model.defaultAspectRatio);
  const [generateAudio, setGenerateAudio] = useState<boolean>(model.defaultGenerateAudio);

  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const { refetch: refetchCredits } = useCreditBalance();
  const { videoCredits } = usePricing();

  // Reference groups.
  const firstFrame = useMediaRefs("image", 1);
  const lastFrame = useMediaRefs("image", 1);
  const refImages = useMediaRefs("image", model.references.referenceImages);
  const refVideos = useMediaRefs("video", model.references.referenceVideos);
  const refAudios = useMediaRefs("audio", model.references.referenceAudios);

  // Mutual-exclusion gating (mirrors validateVideoReferences).
  const hasFrames = firstFrame.items.length > 0 || lastFrame.items.length > 0;
  const hasRefImages = refImages.items.length > 0;
  const firstFrameReady = firstFrame.done.length > 0;
  const hasRefImageOrVideo = refImages.done.length > 0 || refVideos.done.length > 0;

  const anyUploading =
    firstFrame.uploading ||
    lastFrame.uploading ||
    refImages.uploading ||
    refVideos.uploading ||
    refAudios.uploading;

  // A reference video bumps Seedance to its pricier "video_in" tier — keep the
  // cost label aligned with what the server will actually bill.
  const hasReferenceVideo = refVideos.done.length > 0;
  const pricingKey = model.pricingKey(resolution, hasReferenceVideo);
  const videoCost = videoCredits(pricingKey, duration);

  const referenceInputs = {
    firstFrame: firstFrame.done[0]?.url ?? null,
    lastFrame: lastFrame.done[0]?.url ?? null,
    referenceImages: refImages.done.map((r) => r.url),
    referenceVideos: refVideos.done.map((r) => r.url),
    referenceAudios: refAudios.done.map((r) => r.url),
  };
  const refCheck = validateVideoReferences(model, referenceInputs);

  const canGenerate =
    !loading && !anyUploading && prompt.trim().length > 0 && refCheck.ok;

  const handleCreationType = (id: string) => {
    const target = CREATION_TYPES.find((c) => c.id === id);
    if (target && !target.available && "href" in target && target.href) {
      router.push(target.href);
    }
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate) return;

    setLoading(true);
    setError(null);

    try {
      const toRef = (items: { url: string; path: string }[]) =>
        items.map((r) => ({ url: r.url, path: r.path }));

      const body = {
        modelId,
        prompt: prompt.trim(),
        duration,
        resolution,
        aspectRatio,
        generateAudio,
        references: {
          firstFrame: firstFrame.done[0] ?? null,
          lastFrame: lastFrame.done[0] ?? null,
          referenceImages: toRef(refImages.done),
          referenceVideos: toRef(refVideos.done),
          referenceAudios: toRef(refAudios.done),
        },
      };

      const response = await fetch("/api/generate-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": newIdempotencyKey(),
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) {
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? videoCost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Generation failed");
      }

      setResultUrl(data.videoUrl);
      setHistoryRefreshKey((k) => k + 1);
      refetchCredits();

      // Clear the consumed references — their temp uploads were removed server-side.
      firstFrame.reset();
      lastFrame.reset();
      refImages.reset();
      refVideos.reset();
      refAudios.reset();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const selectedCreation = CREATION_TYPES.find((c) => c.id === "text2video");

  return (
    <div className="min-h-screen bg-[#030712] text-white selection:bg-purple-500/30">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -left-[10%] -top-[10%] h-[40%] w-[40%] rounded-full bg-purple-900/20 blur-[120px]" />
        <div className="absolute -right-[10%] top-[20%] h-[30%] w-[30%] rounded-full bg-indigo-900/20 blur-[120px]" />
      </div>

      <div className="relative z-10 mx-auto max-w-5xl px-6 py-12">
        <div className="mb-8">
          <h1 className="mb-3 bg-gradient-to-b from-white to-gray-400 bg-clip-text text-4xl font-bold tracking-tight text-transparent">
            Video studio
          </h1>
          <p className="text-sm text-gray-500">
            Generate cinematic clips from a prompt — add reference frames, images, videos, or audio to steer the result.
          </p>
        </div>

        <form onSubmit={handleGenerate} className="relative z-20 mt-10">
          <style>{`
            @keyframes omniDotDrift { from { background-position: 0 0; } to { background-position: 48px 48px; } }
            @keyframes omniDotsPulse { 0%, 100% { opacity: 0.25; } 50% { opacity: 0.6; } }
          `}</style>
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[180%] w-[135%] -translate-x-1/2 -translate-y-1/2"
            style={{
              backgroundImage:
                "radial-gradient(circle, rgba(168,85,247,0.55) 1.2px, transparent 1.6px)",
              backgroundSize: "24px 24px",
              maskImage:
                "radial-gradient(ellipse 55% 55% at 50% 50%, #000 0%, rgba(0,0,0,0.35) 45%, transparent 72%)",
              WebkitMaskImage:
                "radial-gradient(ellipse 55% 55% at 50% 50%, #000 0%, rgba(0,0,0,0.35) 45%, transparent 72%)",
              animation:
                "omniDotDrift 14s linear infinite, omniDotsPulse 5s ease-in-out infinite",
            }}
          />

          {/* Top-left chips: creation type + model */}
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <ChipDropdown
              icon={<Layers className="h-3.5 w-3.5" />}
              value={selectedCreation?.label ?? "Creation"}
              activeId="text2video"
              options={CREATION_TYPES.map((c) => ({
                id: c.id,
                label: c.label,
                hint: c.available ? undefined : "Open",
              }))}
              onSelect={handleCreationType}
              disabled={loading}
            />
            <ChipDropdown
              icon={<Cpu className="h-3.5 w-3.5" />}
              value={model.modelLabel}
              activeId={modelId}
              options={VIDEO_MODELS.map((m) => ({ id: m.id, label: m.modelLabel }))}
              onSelect={(id) => setModelId(id as VideoModelId)}
              disabled={loading}
            />
          </div>

          <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-colors focus-within:border-purple-400/40 sm:p-5">
            {/* Prompt */}
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder='Describe the scene — camera moves, subject, mood. Use double quotes for spoken dialogue, and [Image1]/[Video1]/[Audio1] to reference attachments.'
              rows={3}
              className="min-h-[64px] w-full resize-none bg-transparent text-base text-white placeholder:text-gray-500 focus:outline-none"
            />

            {/* Controls row */}
            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <ChipDropdown
                  square
                  showChevron={false}
                  icon={<Clock className="h-3.5 w-3.5" />}
                  value={`${duration}s`}
                  activeId={String(duration)}
                  options={model.durations.map((d) => ({
                    id: String(d),
                    label: `${d} seconds`,
                    hint: `${videoCredits(pricingKey, d)}`,
                  }))}
                  onSelect={(id) => setDuration(Number(id))}
                  disabled={loading}
                />
                <ChipDropdown
                  square
                  showChevron={false}
                  icon={<Maximize2 className="h-3.5 w-3.5" />}
                  value={resolution}
                  activeId={resolution}
                  options={model.resolutions.map((r) => ({
                    id: r,
                    label: r,
                    hint: `${videoCredits(model.pricingKey(r, hasReferenceVideo), duration)}`,
                  }))}
                  onSelect={(id) => setResolution(id as VideoResolution)}
                  disabled={loading}
                />
                <ChipDropdown
                  square
                  showChevron={false}
                  icon={<Crop className="h-3.5 w-3.5" />}
                  value={ASPECT_RATIO_LABELS[aspectRatio]}
                  activeId={aspectRatio}
                  options={model.aspectRatios.map((a) => ({
                    id: a,
                    label: ASPECT_RATIO_LABELS[a],
                  }))}
                  onSelect={(id) => setAspectRatio(id as VideoAspectRatio)}
                  disabled={loading}
                />
                {model.supportsAudio && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={() => setGenerateAudio((v) => !v)}
                    className={`flex h-10 items-center gap-2 rounded-[4px] border px-3 text-sm font-semibold transition-colors disabled:opacity-40 ${
                      generateAudio
                        ? "border-purple-400/50 bg-purple-500/15 text-white"
                        : "border-white/10 bg-white/5 text-gray-300 hover:border-white/25"
                    }`}
                    title={generateAudio ? "Audio generation on" : "Audio generation off"}
                  >
                    {generateAudio ? (
                      <Volume2 className="h-3.5 w-3.5 text-purple-300" />
                    ) : (
                      <VolumeX className="h-3.5 w-3.5 text-gray-400" />
                    )}
                    Audio
                  </button>
                )}
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={!canGenerate}
                  className="flex h-10 items-center justify-center gap-2 rounded-[4px] bg-gradient-to-r from-fuchsia-500 to-pink-500 px-6 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-pink-500/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <>
                      <span>Generate</span>
                      <Wand2 className="h-4 w-4" />
                      <span className="text-sm font-extrabold">{videoCost}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* References */}
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 pl-1 text-xs font-semibold uppercase tracking-widest text-gray-500">
              <Sparkles className="h-3.5 w-3.5 text-purple-300" />
              References
              <span className="font-normal normal-case tracking-normal text-gray-600">(optional)</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <RefGroup
                icon={<ImageIcon className="h-3.5 w-3.5" />}
                label="First frame"
                accept={IMAGE_ACCEPT}
                multiple={false}
                group={firstFrame}
                disabled={loading || hasRefImages}
                disabledReason={hasRefImages ? "Remove reference images to use a first frame." : undefined}
                hint="Image-to-video starting frame."
              />
              <RefGroup
                icon={<ImageIcon className="h-3.5 w-3.5" />}
                label="Last frame"
                accept={IMAGE_ACCEPT}
                multiple={false}
                group={lastFrame}
                disabled={loading || hasRefImages || !firstFrameReady}
                disabledReason={
                  hasRefImages
                    ? "Remove reference images to use a last frame."
                    : !firstFrameReady
                      ? "Add a first frame first."
                      : undefined
                }
                hint="End frame (needs a first frame)."
              />
              <RefGroup
                icon={<ImageIcon className="h-3.5 w-3.5" />}
                label="Reference images"
                accept={IMAGE_ACCEPT}
                multiple
                group={refImages}
                disabled={loading || hasFrames}
                disabledReason={hasFrames ? "Remove first/last frame to use reference images." : undefined}
                hint="Character / style / composition. Use [Image1]…"
              />
              <RefGroup
                icon={<Film className="h-3.5 w-3.5" />}
                label="Reference videos"
                accept={VIDEO_ACCEPT}
                multiple
                group={refVideos}
                disabled={loading}
                hint="Motion / style transfer. Use [Video1]…"
              />
              <RefGroup
                icon={<Music className="h-3.5 w-3.5" />}
                label="Reference audio"
                accept={AUDIO_ACCEPT}
                multiple
                group={refAudios}
                disabled={loading || !hasRefImageOrVideo}
                disabledReason={
                  !hasRefImageOrVideo
                    ? "Add a reference image or video to use audio."
                    : undefined
                }
                hint="Audio-driven / lip-sync. Use [Audio1]…"
              />
            </div>
          </div>

          {!refCheck.ok && (
            <p className="mt-2 pl-1 text-xs text-amber-300/80">{refCheck.error}</p>
          )}
        </form>

        {error && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading && (
          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
            <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
            Generating your video with {model.modelLabel} — this can take a couple of minutes. It will appear below when ready.
          </div>
        )}

        {resultUrl && !loading && (
          <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 sm:flex-row">
            <video
              src={resultUrl}
              controls
              playsInline
              className="w-full max-w-xs shrink-0 rounded-2xl border border-white/10 bg-black"
            />
            <div className="min-w-0">
              <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
                <Check className="h-3 w-3" />
                Saved to your library
              </div>
              <p className="text-sm text-gray-300">
                {model.modelLabel} · {duration}s · {resolution} · {ASPECT_RATIO_LABELS[aspectRatio]}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Find it in your history below, or generate another.
              </p>
            </div>
          </div>
        )}

        {/* Video generation history */}
        <div className="mt-[120px]">
          <CreationsHistory
            title="Generation history"
            description="Every video you create appears here. Click any clip to preview it."
            tools={["video_text2video"]}
            mediaType="video"
            refreshKey={historyRefreshKey}
            showActions
            showMeta={false}
            limit={20}
          />
        </div>
      </div>
    </div>
  );
}
