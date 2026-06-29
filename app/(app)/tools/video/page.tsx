"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
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
  Repeat,
  UserRound,
  SlidersHorizontal,
  Languages,
  Upload,
  Pencil,
  Mic,
  Smile,
  CalendarClock,
  Download,
  Type,
  Minus,
} from "lucide-react";
import CreationsHistory from "@/components/CreationsHistory";
import { useCreditBalance } from "@/app/(app)/credit-balance-context";
import { usePricing } from "@/app/(app)/pricing-context";
import { getSupabaseBrowser } from "@/lib/supabase-browser";
import { useIdempotentSubmit } from "@/lib/use-idempotent-submit";
import {
  VIDEO_MODELS,
  getVideoModel,
  getAllowedDurations,
  validateVideoReferences,
  STORYBOARD_VIDEO_MODEL_IDS,
  DEFAULT_STORYBOARD_VIDEO_MODEL_ID,
  type VideoModelId,
  type StoryboardVideoModelId,
  type VideoResolution,
  type VideoAspectRatio,
} from "@/lib/video-models";
import {
  MOTION_CONTROL_MODELS,
  getMotionControlModel,
  effectiveMotionControlDuration,
  motionControlResolutionLabel,
  type MotionControlModelId,
  type MotionControlMode,
  type CharacterOrientation,
} from "@/lib/motion-control-models";
import {
  resolveStoryboardAspectRatio,
  storyboardOrientationLabel,
  type StoryboardAspectRatio,
  STORYBOARD_ASPECT_RATIOS,
  DEFAULT_STORYBOARD_ASPECT_RATIO,
  STORYBOARD_LANGUAGES,
  DEFAULT_STORYBOARD_LANGUAGE,
  resolveStoryboardLanguage,
  storyboardLanguageLabel,
  type StoryboardLanguageId,
  STORYBOARD_STYLE_KEYS,
  STORYBOARD_STYLE_LABELS,
  DEFAULT_STORYBOARD_STYLE,
  type StoryboardStyleKey,
  SEEDANCE_PROMPT_BODY_BUDGET_CHARS,
} from "@/lib/storyboard-style";
import {
  reelsPricingKey,
  reelsTotalDurationSec,
  reelsEngineLabel,
  REELS_ENGINES,
  DEFAULT_VOICE_ID,
  type SeedanceResolution,
  type VeoResolution,
} from "@/lib/reels-models";
import type { ReelsEngine, ReelsVeoMode } from "@/lib/reels-pipeline/types";

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

// Creation types in the top-left chip. All four are now wired in-page.
const CREATION_TYPES = [
  { id: "text2video", label: "Text to Video", available: true },
  { id: "motion_control", label: "Motion Control", available: true },
  { id: "storyboard", label: "Storyboard to Video", available: true },
  { id: "reels-creator", label: "Reels Creator", available: true },
] as const;

type VideoCreationType =
  | "text2video"
  | "motion_control"
  | "storyboard"
  | "reels-creator";

// Motion Control character source: an uploaded file, or one previously created
// in Photo → Character (stored as a product_photo creation, kind "character").
type CharacterSource = "upload" | "library";
type LibraryCharacter = { id: string; url: string; title: string };

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

// Glassy floating tooltip bubble shown above its anchor. The anchor's wrapper
// must be position:relative. Always rendered (so it can fade) but inert when
// hidden. Visibility is driven by the caller's hover/focus state.
function TooltipBubble({ label, show }: { label: string; show: boolean }) {
  return (
    <span
      role="tooltip"
      className={`pointer-events-none absolute bottom-full left-1/2 z-[80] mb-2 w-max max-w-[260px] -translate-x-1/2 rounded-xl border border-white/10 bg-[#0b1020]/95 px-3 py-2 text-center text-xs font-medium leading-snug text-gray-200 shadow-2xl shadow-black/60 backdrop-blur-md transition-all duration-150 ${
        show ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
      }`}
    >
      {label}
      <span className="absolute left-1/2 top-full h-2 w-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-b border-r border-white/10 bg-[#0b1020]/95" />
    </span>
  );
}

// Wraps any element with a hover/focus tooltip. Use for plain buttons; the
// ChipDropdown has its own built-in tooltip support via the `tooltip` prop.
function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [show, setShow] = useState(false);
  return (
    <div
      className="relative inline-flex"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocusCapture={() => setShow(true)}
      onBlurCapture={() => setShow(false)}
    >
      {children}
      <TooltipBubble label={label} show={show} />
    </div>
  );
}

function ChipDropdown({
  icon,
  value,
  options,
  activeId,
  onSelect,
  disabled,
  square = false,
  showChevron = true,
  tooltip,
}: {
  icon: React.ReactNode;
  value: string;
  options: ChipOption[];
  activeId: string;
  onSelect: (id: string) => void;
  disabled?: boolean;
  square?: boolean;
  showChevron?: boolean;
  tooltip?: string;
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(false);
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
    <div
      ref={ref}
      className="relative"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onFocusCapture={() => setHover(true)}
      onBlurCapture={() => setHover(false)}
    >
      {tooltip && (
        <TooltipBubble label={tooltip} show={hover && !open && !disabled} />
      )}
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

// Motion Control "Your character" input. Lets the user either upload an image OR
// pick a character they previously generated in Photo → Character creation
// (stored as a product_photo creation with metadata.creationKind === "character").
function CharacterPicker({
  group,
  source,
  onSourceChange,
  selected,
  onSelect,
  disabled,
}: {
  group: RefGroupApi;
  source: CharacterSource;
  onSourceChange: (s: CharacterSource) => void;
  selected: LibraryCharacter | null;
  onSelect: (c: LibraryCharacter | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<LibraryCharacter[]>([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "loaded" | "error">(
    "idle"
  );
  // Guards the fetch so it runs exactly once. We intentionally do NOT cancel the
  // request on cleanup: tying cancellation to a state/dep change here would abort
  // the in-flight fetch the instant we flip to "loading" and leave it stuck.
  const startedRef = useRef(false);

  const loadCharacters = useCallback(() => {
    startedRef.current = true;
    setLoadState("loading");
    fetch(
      "/api/creations/history?tool=product_photo&mediaType=image&kind=character&limit=60"
    )
      .then((r) => r.json())
      .then((d: { items?: { id: string; mediaUrl?: string; title?: string }[] }) => {
        const list: LibraryCharacter[] = (d.items ?? [])
          .filter((it) => !!it.mediaUrl)
          .map((it) => ({ id: it.id, url: it.mediaUrl as string, title: it.title || "Character" }));
        setItems(list);
        setLoadState("loaded");
      })
      .catch(() => setLoadState("error"));
  }, []);

  // Lazily load saved characters the first time the user opens the library tab.
  useEffect(() => {
    if (source !== "library" || startedRef.current) return;
    loadCharacters();
  }, [source, loadCharacters]);

  const uploaded = group.items[0];

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
          <span className="text-purple-300">
            <UserRound className="h-3.5 w-3.5" />
          </span>
          Your character
        </span>
        <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-white/5 p-0.5">
          {([
            { id: "upload", label: "Upload" },
            { id: "library", label: "My characters" },
          ] as const).map((opt) => (
            <button
              key={opt.id}
              type="button"
              disabled={disabled}
              onClick={() => onSourceChange(opt.id)}
              className={`rounded-full px-2.5 py-1 text-[10px] font-semibold transition-colors disabled:opacity-40 ${
                source === opt.id
                  ? "bg-purple-500/25 text-white"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {source === "upload" ? (
        <>
          <div className="flex flex-wrap gap-2">
            {uploaded ? (
              <RefTile item={uploaded} onRemove={() => group.remove(uploaded.id)} />
            ) : (
              <button
                type="button"
                disabled={disabled}
                onClick={() => inputRef.current?.click()}
                className="flex h-16 w-16 shrink-0 flex-col items-center justify-center gap-1 rounded-[4px] border border-dashed border-white/15 bg-white/5 text-[10px] font-semibold uppercase tracking-wide text-gray-400 transition-colors hover:border-purple-400/50 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
              >
                <Plus className="h-4 w-4" />
                <span>Add</span>
              </button>
            )}
          </div>
          <p className="mt-2 text-[10px] text-gray-600">
            A clear image with a visible face and body. JPG/PNG.
          </p>
          <input
            ref={inputRef}
            type="file"
            accept={MC_IMAGE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) group.add(e.target.files);
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
        </>
      ) : loadState === "loading" || loadState === "idle" ? (
        <div className="flex h-16 items-center gap-2 text-[11px] text-gray-500">
          <Loader2 className="h-4 w-4 animate-spin text-purple-300" />
          Loading your characters…
        </div>
      ) : loadState === "error" ? (
        <div className="flex h-16 items-center gap-2 text-[11px] text-red-300">
          <AlertCircle className="h-4 w-4" /> Couldn&apos;t load your characters.
          <button
            type="button"
            onClick={loadCharacters}
            className="font-semibold text-purple-300 underline-offset-2 hover:underline"
          >
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex h-16 flex-col justify-center gap-1 text-[11px] text-gray-500">
          <span>No saved characters yet.</span>
          <a
            href="/tools/photo-v2"
            className="font-semibold text-purple-300 hover:text-purple-200"
          >
            Create one in Photo → Character →
          </a>
        </div>
      ) : (
        <>
          <div className="grid max-h-44 grid-cols-3 gap-2 overflow-y-auto pr-1">
            {items.map((c) => {
              const active = selected?.id === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onSelect(active ? null : c)}
                  title={c.title}
                  className={`relative aspect-square overflow-hidden rounded-[6px] border transition-colors disabled:opacity-40 ${
                    active
                      ? "border-purple-400 ring-2 ring-purple-400/40"
                      : "border-white/10 hover:border-white/30"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={c.url}
                    alt={c.title}
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                  {active && (
                    <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-purple-500 text-white">
                      <Check className="h-2.5 w-2.5" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-[10px] text-gray-600">
            {selected ? `Selected: ${selected.title}` : "Tap a character to animate."}
          </p>
        </>
      )}
    </div>
  );
}

const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
const VIDEO_ACCEPT = "video/mp4,video/quicktime,video/webm";
const AUDIO_ACCEPT = "audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/ogg,audio/webm";

function VideoOmniPage() {
  const searchParams = useSearchParams();

  // Deep-link support: the Photo → Storyboard "Create video" CTA navigates here
  // with ?type=storyboard&storyboardId=...; the dashboard reels links use
  // ?type=reels-creator. Any known subtool can be preselected via ?type=.
  const typeParam = searchParams.get("type");
  const initialType: VideoCreationType =
    typeParam === "storyboard"
      ? "storyboard"
      : typeParam === "motion_control"
        ? "motion_control"
        : typeParam === "reels-creator"
          ? "reels-creator"
          : "text2video";
  const initialStoryboardId = searchParams.get("storyboardId") || null;

  const [creationType, setCreationType] = useState<VideoCreationType>(initialType);
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const { refetch: refetchCredits } = useCreditBalance();

  const handleCreationType = (id: string) => {
    if (
      id === "text2video" ||
      id === "motion_control" ||
      id === "storyboard" ||
      id === "reels-creator"
    ) {
      setCreationType(id);
    }
  };

  const [modelId, setModelId] = useState<VideoModelId>(VIDEO_MODELS[0].id);
  const model = getVideoModel(modelId);

  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState<number>(model.defaultDuration);
  const [resolution, setResolution] = useState<VideoResolution>(model.defaultResolution);
  const [aspectRatio, setAspectRatio] = useState<VideoAspectRatio>(model.defaultAspectRatio);
  const [generateAudio, setGenerateAudio] = useState<boolean>(model.defaultGenerateAudio);

  // When the model changes, keep the parameters valid for the newly-selected model
  // (e.g. switching away from Seedance 2 — which supports 1080p — back to the Fast
  // variant must drop 1080p down to a supported resolution).
  useEffect(() => {
    const m = getVideoModel(modelId);
    setResolution((r) => (m.resolutions.includes(r) ? r : m.defaultResolution));
    setAspectRatio((a) => (m.aspectRatios.includes(a) ? a : m.defaultAspectRatio));
    if (!m.supportsAudio) setGenerateAudio(false);
  }, [modelId]);

  // Keep duration valid for the current model + resolution. Some models restrict
  // durations at certain resolutions (e.g. Veo 3.1 Lite only allows 8s at 1080p).
  useEffect(() => {
    const m = getVideoModel(modelId);
    const allowed = getAllowedDurations(m, resolution);
    setDuration((d) =>
      allowed.includes(d)
        ? d
        : allowed.includes(m.defaultDuration)
          ? m.defaultDuration
          : allowed[allowed.length - 1]
    );
  }, [modelId, resolution]);

  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Double-submit / double-charge guard (see lib/use-idempotent-submit.ts).
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling } = useIdempotentSubmit();

  const { videoCredits } = usePricing();

  // Reference groups.
  const firstFrame = useMediaRefs("image", 1);
  const lastFrame = useMediaRefs("image", 1);
  const refImages = useMediaRefs("image", model.references.referenceImages);
  const refVideos = useMediaRefs("video", model.references.referenceVideos);
  const refAudios = useMediaRefs("audio", model.references.referenceAudios);

  // Drop any references the newly-selected model can't accept (e.g. switching to
  // Veo 3.1 Fast, which only supports first/last frame — no reference arrays).
  useEffect(() => {
    const caps = getVideoModel(modelId).references;
    if (!caps.firstFrame) firstFrame.reset();
    if (!caps.lastFrame) lastFrame.reset();
    if (caps.referenceImages === 0) refImages.reset();
    if (caps.referenceVideos === 0) refVideos.reset();
    if (caps.referenceAudios === 0) refAudios.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId]);

  // Mutual-exclusion gating (mirrors validateVideoReferences).
  const hasFrames = firstFrame.items.length > 0 || lastFrame.items.length > 0;
  const hasRefImages = refImages.items.length > 0;
  const firstFrameReady = firstFrame.done.length > 0;
  const hasRefImageOrVideo = refImages.done.length > 0 || refVideos.done.length > 0;
  const refImagesBlocked1080p =
    model.providerFamily === "seedance1lite" && resolution === "1080p";
  const resolution1080pBlockedByRefs =
    model.providerFamily === "seedance1lite" && hasRefImages;

  useEffect(() => {
    if (resolution1080pBlockedByRefs && resolution === "1080p") {
      setResolution("720p");
    }
  }, [resolution1080pBlockedByRefs, resolution]);

  const anyUploading =
    firstFrame.uploading ||
    lastFrame.uploading ||
    refImages.uploading ||
    refVideos.uploading ||
    refAudios.uploading;

  // A reference video bumps Seedance to its pricier "video_in" tier — keep the
  // cost label aligned with what the server will actually bill.
  const hasReferenceVideo = refVideos.done.length > 0;
  const pricingKey = model.pricingKey({ resolution, hasReferenceVideo, generateAudio });
  const videoCost = videoCredits(pricingKey, duration);

  const referenceInputs = {
    firstFrame: firstFrame.done[0]?.url ?? null,
    lastFrame: lastFrame.done[0]?.url ?? null,
    referenceImages: refImages.done.map((r) => r.url),
    referenceVideos: refVideos.done.map((r) => r.url),
    referenceAudios: refAudios.done.map((r) => r.url),
  };
  const refCheck = validateVideoReferences(model, referenceInputs, { resolution });

  const canGenerate =
    !loading && !anyUploading && prompt.trim().length > 0 && refCheck.ok;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate) return;

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

    // Stable key per attempt + synchronous in-flight lock: a double-click or a
    // retry after a network blip can't spawn a second provider run. The full
    // body is the signature, so any input change rotates the key.
    const attempt = beginSubmit(JSON.stringify(body));
    if (!attempt) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/generate-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) {
        // User-initiated cancellation: return to idle (credits were refunded),
        // not a red error. settle(false) keeps the key so a same-input retry
        // takes over the cancelled attempt server-side.
        if (data.code === "GENERATION_CANCELLED") {
          attempt.settle(false);
          setError(null);
          refetchCredits();
          return;
        }
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? videoCost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Generation failed");
      }

      attempt.settle(true);
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
      attempt.settle(false);
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

        {creationType === "text2video" && (
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
              maxLength={model.promptMaxChars}
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
                  tooltip="How long the generated clip is, in seconds. Longer clips cost more credits."
                  options={getAllowedDurations(model, resolution).map((d) => ({
                    id: String(d),
                    label: `${d} seconds`,
                    hint: `${videoCredits(pricingKey, d)}`,
                  }))}
                  onSelect={(id) => setDuration(Number(id))}
                  disabled={loading}
                />
                {model.resolutions.length > 1 && (
                <ChipDropdown
                  square
                  showChevron={false}
                  icon={<Maximize2 className="h-3.5 w-3.5" />}
                  value={resolution}
                  activeId={resolution}
                  tooltip="Video resolution. Higher resolution is crisper but costs more credits."
                  options={model.resolutions
                    .filter((r) => !(resolution1080pBlockedByRefs && r === "1080p"))
                    .map((r) => ({
                      id: r,
                      label: r,
                      hint: `${videoCredits(model.pricingKey({ resolution: r, hasReferenceVideo, generateAudio }), duration)}`,
                    }))}
                  onSelect={(id) => setResolution(id as VideoResolution)}
                  disabled={loading}
                />
                )}
                <ChipDropdown
                  square
                  showChevron={false}
                  icon={<Crop className="h-3.5 w-3.5" />}
                  value={ASPECT_RATIO_LABELS[aspectRatio]}
                  activeId={aspectRatio}
                  tooltip="Shape of the frame. 9:16 is vertical (Reels/TikTok), 16:9 is widescreen, 1:1 is square."
                  options={model.aspectRatios.map((a) => ({
                    id: a,
                    label: ASPECT_RATIO_LABELS[a],
                  }))}
                  onSelect={(id) => setAspectRatio(id as VideoAspectRatio)}
                  disabled={loading}
                />
                {model.supportsAudio && (
                  <Tooltip
                    label={
                      generateAudio
                        ? "On — the model generates synced audio (dialogue, SFX, music). Click to make it silent."
                        : "Off — the video is silent. Click to generate audio (may cost more)."
                    }
                  >
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => setGenerateAudio((v) => !v)}
                      className={`flex h-10 items-center gap-2 rounded-[4px] border px-3 text-sm font-semibold transition-colors disabled:opacity-40 ${
                        generateAudio
                          ? "border-purple-400/50 bg-purple-500/15 text-white"
                          : "border-white/10 bg-white/5 text-gray-300 hover:border-white/25"
                      }`}
                    >
                      {generateAudio ? (
                        <Volume2 className="h-3.5 w-3.5 text-purple-300" />
                      ) : (
                        <VolumeX className="h-3.5 w-3.5 text-gray-400" />
                      )}
                      Audio
                    </button>
                  </Tooltip>
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
                {loading && (
                  <button
                    type="button"
                    onClick={() => cancelSubmit()}
                    disabled={cancelling}
                    className="flex h-10 items-center justify-center gap-2 rounded-[4px] border border-red-500/40 bg-red-500/10 px-4 text-sm font-bold uppercase tracking-wide text-red-300 transition-all hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {cancelling ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Cancelling</span>
                      </>
                    ) : (
                      <span>Cancel</span>
                    )}
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* References */}
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 pl-1 text-xs font-semibold uppercase tracking-widest text-gray-500">
              <Sparkles className="h-3.5 w-3.5 text-purple-300" />
              References
              {model.requiresFirstFrame ? (
                <span className="font-normal normal-case tracking-normal text-amber-300/90">
                  (start image required)
                </span>
              ) : (
                <span className="font-normal normal-case tracking-normal text-gray-600">(optional)</span>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {model.references.firstFrame && (
                <RefGroup
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  label={model.requiresFirstFrame ? "Start image" : "First frame"}
                  accept={IMAGE_ACCEPT}
                  multiple={false}
                  group={firstFrame}
                  disabled={loading || hasRefImages}
                  disabledReason={hasRefImages ? "Remove reference images to use a first frame." : undefined}
                  hint={
                    model.requiresFirstFrame
                      ? "Required — this model is image-to-video only."
                      : "Image-to-video starting frame."
                  }
                />
              )}
              {model.references.lastFrame && (
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
              )}
              {model.references.referenceImages > 0 && (
                <RefGroup
                  icon={<ImageIcon className="h-3.5 w-3.5" />}
                  label="Reference images"
                  accept={IMAGE_ACCEPT}
                  multiple
                  group={refImages}
                  disabled={loading || hasFrames || refImagesBlocked1080p}
                  disabledReason={
                    hasFrames
                      ? "Remove first/last frame to use reference images."
                      : refImagesBlocked1080p
                        ? "Reference images are only supported at 480p or 720p."
                        : undefined
                  }
                  hint="Character / style / composition (480p–720p only). Use [Image1]…"
                />
              )}
              {model.references.referenceVideos > 0 && (
                <RefGroup
                  icon={<Film className="h-3.5 w-3.5" />}
                  label="Reference videos"
                  accept={VIDEO_ACCEPT}
                  multiple
                  group={refVideos}
                  disabled={loading}
                  hint="Motion / style transfer. Use [Video1]…"
                />
              )}
              {model.references.referenceAudios > 0 && (
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
              )}
            </div>
          </div>

          {!refCheck.ok && (
            <p className="mt-2 pl-1 text-xs text-amber-300/80">{refCheck.error}</p>
          )}
        </form>
        )}

        {creationType === "text2video" && error && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {creationType === "text2video" && loading && (
          <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
            <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
            Generating your video with {model.modelLabel} — this can take a couple of minutes. It will appear below when ready.
          </div>
        )}

        {creationType === "text2video" && resultUrl && !loading && (
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

        {creationType === "motion_control" && (
          <MotionControlComposer
            onSelectCreation={handleCreationType}
            onGenerated={() => {
              setHistoryRefreshKey((k) => k + 1);
              refetchCredits();
            }}
          />
        )}

        {creationType === "storyboard" && (
          <StoryboardToVideoComposer
            initialStoryboardId={initialStoryboardId}
            onSelectCreation={handleCreationType}
            onGenerated={() => {
              setHistoryRefreshKey((k) => k + 1);
              refetchCredits();
            }}
          />
        )}

        {creationType === "reels-creator" && (
          <ReelsCreatorComposer
            onSelectCreation={handleCreationType}
            onGenerated={() => {
              setHistoryRefreshKey((k) => k + 1);
              refetchCredits();
            }}
          />
        )}

        {/* Video generation history */}
        <div className="mt-[120px]">
          <CreationsHistory
            title="Generation history"
            description="Every video you create appears here. Click any clip to preview it."
            tools={[
              "video_text2video",
              "video_motion_control",
              "storyboard_video",
              "reels_seedance",
              "reels_veo",
            ]}
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

// useSearchParams() requires a Suspense boundary in the App Router. Wrap the page
// so the storyboard deep-link (?type=storyboard&storyboardId=...) reads cleanly.
export default function VideoOmniPageWrapper() {
  return (
    <Suspense fallback={null}>
      <VideoOmniPage />
    </Suspense>
  );
}

const MC_IMAGE_ACCEPT = "image/jpeg,image/png";
const MC_VIDEO_ACCEPT = "video/mp4,video/quicktime";

// Motion Control sub-tool. Mirrors the Higgsfield UX: upload your character image
// + the motion video to copy, optionally write a prompt, pick quality/orientation,
// and keep (or drop) the reference video's audio. The output clip length follows
// the reference video, so the cost is computed from its measured duration.
function MotionControlComposer({
  onSelectCreation,
  onGenerated,
}: {
  onSelectCreation: (id: string) => void;
  onGenerated: () => void;
}) {
  const [modelId, setModelId] = useState<MotionControlModelId>(MOTION_CONTROL_MODELS[0].id);
  const model = getMotionControlModel(modelId);

  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<MotionControlMode>(model.defaultMode);
  const [orientation, setOrientation] = useState<CharacterOrientation>(model.defaultOrientation);
  const [keepOriginalSound, setKeepOriginalSound] = useState<boolean>(
    model.defaultKeepOriginalSound
  );
  const [videoDurationSec, setVideoDurationSec] = useState<number | null>(null);

  // Character source: upload your own, or pick one created in Photo → Character.
  const [charSource, setCharSource] = useState<CharacterSource>("upload");
  const [libraryChar, setLibraryChar] = useState<LibraryCharacter | null>(null);

  // The prompt is optional (Kling generates from just the image + motion video),
  // so it lives in a collapsed "Advanced" section to keep the form uncluttered.
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Double-submit / double-charge guard (see lib/use-idempotent-submit.ts).
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling } = useIdempotentSubmit();

  const { videoCredits } = usePricing();

  const charImage = useMediaRefs("image", 1);
  const motionVideo = useMediaRefs("video", 1);

  // Measure the reference video's duration so the cost label matches what the
  // server will bill (output length follows the reference video).
  const motionFile = motionVideo.items[0]?.file ?? null;
  useEffect(() => {
    if (!motionFile) {
      setVideoDurationSec(null);
      return;
    }
    const url = URL.createObjectURL(motionFile);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      setVideoDurationSec(Number.isFinite(el.duration) ? el.duration : null);
      URL.revokeObjectURL(url);
    };
    el.onerror = () => {
      setVideoDurationSec(null);
      URL.revokeObjectURL(url);
    };
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [motionFile]);

  const billedDuration = effectiveMotionControlDuration({
    model,
    refVideoDurationSec: videoDurationSec,
    orientation,
  });
  const pricingKey = model.pricingKey(mode);
  const cost = videoCredits(pricingKey, billedDuration);

  // Resolve the character image from whichever source is active. A library
  // character is a permanent creation (public URL), so it carries no temp path —
  // the server only sweeps temp upload paths, never library items.
  const resolvedCharacter: { url: string; path: string } | null =
    charSource === "library"
      ? libraryChar
        ? { url: libraryChar.url, path: "" }
        : null
      : charImage.done[0]
        ? { url: charImage.done[0].url, path: charImage.done[0].path }
        : null;

  const imageReady = resolvedCharacter !== null;
  const videoReady = motionVideo.done.length > 0;
  const anyUploading =
    motionVideo.uploading || (charSource === "upload" && charImage.uploading);
  const canGenerate = !loading && !anyUploading && imageReady && videoReady;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate) return;

    const body = {
      modelId,
      prompt: prompt.trim(),
      mode,
      characterOrientation: orientation,
      keepOriginalSound,
      refVideoDurationSec: videoDurationSec,
      image: resolvedCharacter,
      video: motionVideo.done[0]
        ? { url: motionVideo.done[0].url, path: motionVideo.done[0].path }
        : null,
    };

    // Stable key per attempt + synchronous in-flight lock (see hook docs).
    const attempt = beginSubmit(JSON.stringify(body));
    if (!attempt) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/generate-motion-control", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) {
        // User cancellation → back to idle (credits refunded), not a red error.
        if (data.code === "GENERATION_CANCELLED") {
          attempt.settle(false);
          setError(null);
          return;
        }
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? cost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Generation failed");
      }

      attempt.settle(true);
      setResultUrl(data.videoUrl);
      onGenerated();
      charImage.reset();
      motionVideo.reset();
      setLibraryChar(null);
    } catch (err: unknown) {
      attempt.settle(false);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  const orientationLabel =
    orientation === "video" ? "Facing: video (≤30s)" : "Facing: photo (≤10s)";

  return (
    <>
      <form onSubmit={handleGenerate} className="relative z-20 mt-10">
        {/* Top-left chips: creation type + model */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ChipDropdown
            icon={<Layers className="h-3.5 w-3.5" />}
            value="Motion Control"
            activeId="motion_control"
            options={CREATION_TYPES.map((c) => ({
              id: c.id,
              label: c.label,
              hint: c.available ? undefined : "Open",
            }))}
            onSelect={onSelectCreation}
            disabled={loading}
          />
          <ChipDropdown
            icon={<Cpu className="h-3.5 w-3.5" />}
            value={model.modelLabel}
            activeId={modelId}
            options={MOTION_CONTROL_MODELS.map((m) => ({ id: m.id, label: m.modelLabel }))}
            onSelect={(id) => setModelId(id as MotionControlModelId)}
            disabled={loading}
          />
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm sm:p-5">
          {/* Uploads: character image + motion video (both required) */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <CharacterPicker
              group={charImage}
              source={charSource}
              onSourceChange={setCharSource}
              selected={libraryChar}
              onSelect={setLibraryChar}
              disabled={loading}
            />
            <RefGroup
              icon={<Film className="h-3.5 w-3.5" />}
              label="Motion to copy"
              accept={MC_VIDEO_ACCEPT}
              multiple={false}
              group={motionVideo}
              disabled={loading}
              hint={
                videoDurationSec
                  ? `Reference video ~${Math.round(videoDurationSec)}s · billed ${billedDuration}s. MP4/MOV.`
                  : "Reference motion video, 3–30s. The character copies this motion. MP4/MOV."
              }
            />
          </div>

          {/* Advanced settings (collapsed by default). The prompt is optional —
              Kling generates from just the character image + motion video — so we
              tuck it away here. Motion still comes from the reference video; the
              prompt only adds background/scene details. */}
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              aria-expanded={advancedOpen}
              className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 transition-colors hover:text-gray-200"
            >
              <SlidersHorizontal className="h-3.5 w-3.5 text-purple-300" />
              Advanced settings
              {!advancedOpen && prompt.trim() && (
                <span className="rounded-full bg-purple-500/20 px-1.5 py-0.5 text-[10px] font-medium text-purple-200">
                  prompt added
                </span>
              )}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
              />
            </button>
            {advancedOpen && (
              <div className="mt-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-sm font-semibold text-gray-200">Prompt</span>
                  <span className="text-[11px] font-medium text-gray-500">optional</span>
                </div>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  maxLength={model.promptMaxChars}
                  placeholder={'Describe background and scene details \u2013 e.g., "A corgi runs in" or "Snowy park setting". Motion is controlled by your reference video.'}
                  rows={3}
                  className="min-h-[64px] w-full resize-none bg-transparent text-base text-white placeholder:text-gray-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* Controls row */}
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <ChipDropdown
                square
                showChevron={false}
                icon={<Maximize2 className="h-3.5 w-3.5" />}
                value={`${mode === "std" ? "Standard" : "Pro"} · ${motionControlResolutionLabel(mode)}`}
                activeId={mode}
                tooltip="Output quality. Standard renders at 720p; Pro is sharper 1080p but costs more credits."
                options={model.modes.map((m) => ({
                  id: m,
                  label: `${m === "std" ? "Standard" : "Pro"} · ${motionControlResolutionLabel(m)}`,
                  hint: `${videoCredits(model.pricingKey(m), billedDuration)}`,
                }))}
                onSelect={(id) => setMode(id as MotionControlMode)}
                disabled={loading}
              />
              <ChipDropdown
                square
                showChevron={false}
                icon={<Repeat className="h-3.5 w-3.5" />}
                value={orientationLabel}
                activeId={orientation}
                tooltip="Which way your character faces in the result. “Photo” keeps the angle from your character image (clips up to 10s). “Video” makes the character follow the angles in your motion clip (clips up to 30s). This does not change the background."
                options={[
                  { id: "image", label: "Facing: photo (≤10s)" },
                  { id: "video", label: "Facing: video (≤30s)" },
                ]}
                onSelect={(id) => setOrientation(id as CharacterOrientation)}
                disabled={loading}
              />
              <Tooltip
                label={
                  keepOriginalSound
                    ? "On — your result keeps the reference video's original audio. Click to mute it."
                    : "Off — the reference video's audio is removed. Click to keep it."
                }
              >
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => setKeepOriginalSound((v) => !v)}
                  className={`flex h-10 items-center gap-2 rounded-[4px] border px-3 text-sm font-semibold transition-colors disabled:opacity-40 ${
                    keepOriginalSound
                      ? "border-purple-400/50 bg-purple-500/15 text-white"
                      : "border-white/10 bg-white/5 text-gray-300 hover:border-white/25"
                  }`}
                >
                  {keepOriginalSound ? (
                    <Volume2 className="h-3.5 w-3.5 text-purple-300" />
                  ) : (
                    <VolumeX className="h-3.5 w-3.5 text-gray-400" />
                  )}
                  Original sound
                </button>
              </Tooltip>
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
                    <span className="text-sm font-extrabold">{cost}</span>
                  </>
                )}
              </button>
              {loading && (
                <button
                  type="button"
                  onClick={() => cancelSubmit()}
                  disabled={cancelling}
                  className="flex h-10 items-center justify-center gap-2 rounded-[4px] border border-red-500/40 bg-red-500/10 px-4 text-sm font-bold uppercase tracking-wide text-red-300 transition-all hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {cancelling ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Cancelling</span>
                    </>
                  ) : (
                    <span>Cancel</span>
                  )}
                </button>
              )}
            </div>
          </div>

          {!imageReady || !videoReady ? (
            <p className="mt-3 pl-1 text-xs text-amber-300/80">
              Add both your character image and a motion video to generate.
            </p>
          ) : null}
        </div>
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
          Generating with {model.modelLabel} — this can take a couple of minutes. It will appear below when ready.
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
              {model.modelLabel} · {mode === "std" ? "Standard" : "Pro"} · {motionControlResolutionLabel(mode)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Find it in your history below, or generate another.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

type StoryboardListItem = {
  id: string;
  storyboardUrl: string;
  theme: string;
  hasVideo: boolean;
  // The orientation the storyboard was created in. null only for legacy rows
  // saved before the aspect_ratio column existed (then the user may pick it).
  aspectRatio: StoryboardAspectRatio | null;
  // Spoken language the storyboard was written in. null for legacy rows; used as
  // the default here but the user may still change it (soft, re-instructable).
  language: StoryboardLanguageId | null;
  // The stored Seedance prompt — surfaced in the Advanced "edit prompt" panel so
  // the user can review/tweak it before rendering.
  seedancePrompt: string;
  // 'uploaded' for storyboards the user imported, 'generated' otherwise.
  source: string | null;
};

function storyboardVideoPricingKey(
  modelId: StoryboardVideoModelId,
  resolution: "480p" | "720p"
): string {
  return getVideoModel(modelId).pricingKey({ resolution, hasReferenceVideo: false });
}

// Storyboard to Video sub-tool. The storyboard itself is created in Photo →
// Storyboard; here the user picks one of their saved storyboards, a resolution,
// and a Seedance model (Mini default, Fast optional), then renders the 15s clip.
const STORYBOARD_VIDEO_DURATION_SEC = 15;

// Modal for importing a user's OWN storyboard image (not generated in Krakatoa).
// Uploads the file to the transient refs path, then asks /api/storyboards/import
// to run a GPT-5 vision pass (charged) that synthesizes the seedance_prompt and
// registers a storyboards row. On success the new board is handed back to the
// composer, which selects it.
function ImportStoryboardModal({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (item: StoryboardListItem) => void;
}) {
  const { imageCredits } = usePricing();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [aspect, setAspect] = useState<StoryboardAspectRatio>(DEFAULT_STORYBOARD_ASPECT_RATIO);
  const [language, setLanguage] = useState<StoryboardLanguageId>(DEFAULT_STORYBOARD_LANGUAGE);
  const [style, setStyle] = useState<StoryboardStyleKey>(DEFAULT_STORYBOARD_STYLE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Double-submit / double-charge guard (see lib/use-idempotent-submit.ts).
  const { begin: beginSubmit } = useIdempotentSubmit();

  const cost = imageCredits("storyboard_import_vision_per_image", 1);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const pickFile = (f: File | null) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      setError("Please choose a JPG, PNG, or WebP image.");
      return;
    }
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };

  const analyze = async () => {
    if (!file || busy) return;
    // Acquire the synchronous in-flight lock BEFORE the upload so a double-click
    // can't upload the sheet and charge the vision pass twice. Each attempt
    // re-uploads to a fresh temp path (which the server folds into its request
    // hash), so the key is unique per attempt — here the lock, not key reuse, is
    // what prevents the duplicate.
    const attempt = beginSubmit(`storyboard-import:${Date.now()}:${Math.random()}`);
    if (!attempt) return;
    setBusy(true);
    setError(null);
    try {
      const { path } = await uploadRefFile(file);
      const response = await fetch("/api/storyboards/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: JSON.stringify({
          imagePath: path,
          description: description.trim(),
          aspectRatio: aspect,
          language,
          storyboardStyle: style,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? cost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Couldn't import the storyboard.");
      }
      attempt.settle(true);
      onImported({
        id: String(data.storyboardId),
        storyboardUrl: String(data.storyboardUrl),
        theme: description.trim() || "Imported storyboard",
        hasVideo: false,
        aspectRatio: resolveStoryboardAspectRatio(data.aspectRatio),
        language: resolveStoryboardLanguage(data.language),
        seedancePrompt: typeof data.seedancePrompt === "string" ? data.seedancePrompt : "",
        source: "uploaded",
      });
    } catch (err: unknown) {
      attempt.settle(false);
      setError(err instanceof Error ? err.message : "An unexpected error occurred.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={busy ? undefined : onClose}
      />
      <div className="relative z-10 w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-[#0e0e12] shadow-2xl">
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <Upload className="h-4 w-4 text-purple-300" />
            <h3 className="text-sm font-bold text-white">Upload your own storyboard</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-5">
          {/* File picker / preview */}
          <label
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-4 py-6 text-center transition-colors ${
              previewUrl ? "border-white/15 bg-black/30" : "border-white/20 hover:border-purple-400/50"
            } ${busy ? "pointer-events-none opacity-60" : ""}`}
          >
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt="Storyboard preview"
                className="max-h-48 w-auto rounded-lg border border-white/10 object-contain"
              />
            ) : (
              <>
                <Upload className="h-6 w-6 text-gray-400" />
                <span className="text-sm text-gray-300">Click to choose an image</span>
                <span className="text-[11px] text-gray-500">JPG / PNG / WebP · up to 100 MB</span>
              </>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              disabled={busy}
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {previewUrl && (
              <span className="text-[11px] font-semibold text-purple-300">Change image</span>
            )}
          </label>

          {/* Optional description */}
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Description <span className="text-gray-600">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              disabled={busy}
              placeholder="What should happen in the video? Helps steer the analysis."
              className="w-full resize-none rounded-xl border border-white/10 bg-black/30 p-3 text-sm text-white placeholder:text-gray-600 focus:border-purple-400/40 focus:outline-none"
            />
          </div>

          {/* Orientation / language / style */}
          <div className="flex flex-wrap items-center gap-2">
            <ChipDropdown
              square
              showChevron={false}
              icon={<Crop className="h-3.5 w-3.5" />}
              value={aspect}
              activeId={aspect}
              tooltip="Orientation of the video you'll render from this storyboard."
              options={STORYBOARD_ASPECT_RATIOS.map((a) => ({
                id: a,
                label: a,
                hint: storyboardOrientationLabel(a),
              }))}
              onSelect={(id) => setAspect(id as StoryboardAspectRatio)}
              disabled={busy}
            />
            <ChipDropdown
              icon={<Languages className="h-3.5 w-3.5" />}
              value={storyboardLanguageLabel(language)}
              activeId={language}
              tooltip="Spoken language for the video's dialogue."
              options={STORYBOARD_LANGUAGES.map((l) => ({ id: l.id, label: l.label }))}
              onSelect={(id) => setLanguage(id as StoryboardLanguageId)}
              disabled={busy}
            />
            <ChipDropdown
              icon={<Sparkles className="h-3.5 w-3.5" />}
              value={STORYBOARD_STYLE_LABELS[style]}
              activeId={style}
              tooltip="Visual style baked into the generated video prompt."
              options={STORYBOARD_STYLE_KEYS.map((k) => ({
                id: k,
                label: STORYBOARD_STYLE_LABELS[k],
              }))}
              onSelect={(id) => setStyle(id as StoryboardStyleKey)}
              disabled={busy}
            />
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-xs text-red-300">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-4">
          <p className="text-[11px] text-gray-500">
            We analyze the image to write the video prompt — you can edit it before rendering.
          </p>
          <button
            type="button"
            onClick={analyze}
            disabled={!file || busy}
            className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-[4px] bg-gradient-to-r from-fuchsia-500 to-pink-500 px-5 text-sm font-bold uppercase tracking-wide text-white shadow-lg shadow-pink-500/20 transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <>
                <span>Analyze</span>
                <Wand2 className="h-4 w-4" />
                <span className="text-sm font-extrabold">{cost}</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function StoryboardToVideoComposer({
  initialStoryboardId,
  onSelectCreation,
  onGenerated,
}: {
  initialStoryboardId: string | null;
  onSelectCreation: (id: string) => void;
  onGenerated: () => void;
}) {
  const { videoCredits } = usePricing();

  const [items, setItems] = useState<StoryboardListItem[]>([]);
  const [listState, setListState] = useState<"loading" | "loaded" | "error">("loading");
  const [selectedId, setSelectedId] = useState<string | null>(initialStoryboardId);
  const [videoModelId, setVideoModelId] = useState<StoryboardVideoModelId>(
    DEFAULT_STORYBOARD_VIDEO_MODEL_ID
  );
  const [resolution, setResolution] = useState<"480p" | "720p">("480p");
  // Aspect mirrors the selected storyboard's stored orientation (locked) so the
  // clip never flips. Only editable for legacy storyboards that have no ratio.
  const [aspect, setAspect] = useState<StoryboardAspectRatio>("16:9");
  // Language defaults to the storyboard's language but stays EDITABLE — the user
  // can re-voice the same storyboard in another language at video time.
  const [language, setLanguage] = useState<StoryboardLanguageId>(DEFAULT_STORYBOARD_LANGUAGE);

  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Double-submit / double-charge guard: stable Idempotency-Key per attempt +
  // synchronous in-flight lock, so a double-click or a retry after a network
  // blip can never spawn a second Replicate run for the same storyboard.
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling } = useIdempotentSubmit();
  // "Upload your own storyboard" modal.
  const [showUpload, setShowUpload] = useState(false);
  // Advanced: review/edit the Seedance prompt before rendering. Draft is synced
  // to the selected storyboard; only sent (and persisted) when actually changed.
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");

  // Load the user's saved storyboards once. Auto-select the deep-linked one (from
  // Photo's "Create video" CTA), otherwise leave selection to the user.
  useEffect(() => {
    let cancelled = false;
    setListState("loading");
    fetch("/api/storyboards")
      .then((r) => r.json())
      .then((d: { storyboards?: Array<Record<string, unknown>> }) => {
        if (cancelled) return;
        const list: StoryboardListItem[] = (d.storyboards ?? [])
          .filter((s) => typeof s.storyboard_url === "string" && s.storyboard_url)
          .map((s) => ({
            id: String(s.id),
            storyboardUrl: String(s.storyboard_url),
            theme: typeof s.theme === "string" ? s.theme : "Storyboard",
            hasVideo: typeof s.video_url === "string" && !!s.video_url,
            aspectRatio:
              typeof s.aspect_ratio === "string"
                ? resolveStoryboardAspectRatio(s.aspect_ratio)
                : null,
            language:
              typeof s.language === "string"
                ? resolveStoryboardLanguage(s.language)
                : null,
            seedancePrompt:
              typeof s.seedance_prompt === "string" ? s.seedance_prompt : "",
            source: typeof s.source === "string" ? s.source : null,
          }));
        setItems(list);
        setListState("loaded");
        setSelectedId((cur) => {
          if (cur && list.some((s) => s.id === cur)) return cur;
          return list[0]?.id ?? null;
        });
      })
      .catch(() => {
        if (!cancelled) setListState("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const storyboardVideoModel = getVideoModel(videoModelId);
  const pricingKey = storyboardVideoPricingKey(videoModelId, resolution);
  const cost = videoCredits(pricingKey, STORYBOARD_VIDEO_DURATION_SEC);
  const selected = items.find((s) => s.id === selectedId) ?? null;
  const canGenerate = !loading && !!selectedId;
  // When the selected storyboard carries an orientation, the video MUST match it
  // (lock the chip). Legacy boards without one let the user choose.
  const aspectLocked = !!selected?.aspectRatio;

  useEffect(() => {
    if (selected?.aspectRatio) setAspect(selected.aspectRatio);
  }, [selected?.aspectRatio]);

  // Sync language to the selected storyboard (default English) whenever the
  // selection or its stored language changes. Manual overrides persist until the
  // board changes again, since neither dependency moves on a user edit.
  useEffect(() => {
    setLanguage(selected?.language ?? DEFAULT_STORYBOARD_LANGUAGE);
  }, [selectedId, selected?.language]);

  // Reset the editable prompt draft to the selected storyboard's stored prompt
  // when the selection changes (keyed on id so a user edit isn't clobbered).
  useEffect(() => {
    setPromptDraft(selected?.seedancePrompt ?? "");
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  const storedPrompt = selected?.seedancePrompt ?? "";
  const promptDirty = !!selectedId && promptDraft.trim() !== storedPrompt.trim() && promptDraft.trim().length > 0;

  // Splice a freshly imported storyboard into the list and select it.
  const handleImported = (item: StoryboardListItem) => {
    setItems((cur) => [item, ...cur.filter((s) => s.id !== item.id)]);
    setSelectedId(item.id);
    setShowUpload(false);
  };

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate || !selectedId) return;

    const editedPrompt = promptDirty ? promptDraft.trim() : undefined;
    // Signature mirrors the fields the server hashes for idempotency (durationSec
    // is fixed server-side) so the key is reused only while the request is
    // unchanged. begin() returns null when a submit is already in flight — that
    // drops a same-tick double-click before it can fire a second request.
    const signature = JSON.stringify({
      storyboardId: selectedId,
      videoModelId,
      resolution,
      aspectRatio: aspect,
      language,
      promptOverride: editedPrompt ?? null,
    });
    const attempt = beginSubmit(signature);
    if (!attempt) return;

    setLoading(true);
    setError(null);
    setResultUrl(null);
    try {
      const response = await fetch("/api/generate-storyboard-video", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: JSON.stringify({
          storyboardId: selectedId,
          videoModelId,
          resolution,
          aspectRatio: aspect,
          language,
          ...(editedPrompt ? { seedancePrompt: editedPrompt } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        // User cancellation → back to idle (credits refunded), not a red error.
        if (data.code === "GENERATION_CANCELLED") {
          attempt.settle(false);
          setError(null);
          return;
        }
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? cost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Generation failed");
      }
      // Confirmed success (or a server-side replay of the same key): retire the
      // key so the next click starts a fresh generation.
      attempt.settle(true);
      // If the prompt was edited it is now the stored prompt — reflect that in
      // local state so re-selecting the board shows the saved edit.
      if (editedPrompt) {
        setItems((cur) =>
          cur.map((s) => (s.id === selectedId ? { ...s, seedancePrompt: editedPrompt } : s))
        );
      }
      setResultUrl(data.videoUrl);
      onGenerated();
    } catch (err: unknown) {
      // Keep the key so an immediate identical retry dedupes server-side
      // (replay / in-progress / takeover) rather than launching a second run.
      attempt.settle(false);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <form onSubmit={handleGenerate} className="relative z-20 mt-10">
        {/* Top-left chips: creation type + model */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ChipDropdown
            icon={<Layers className="h-3.5 w-3.5" />}
            value="Storyboard to Video"
            activeId="storyboard"
            options={CREATION_TYPES.map((c) => ({
              id: c.id,
              label: c.label,
              hint: c.available ? undefined : "Open",
            }))}
            onSelect={onSelectCreation}
            disabled={loading}
          />
          <ChipDropdown
            icon={<Cpu className="h-3.5 w-3.5" />}
            value={storyboardVideoModel.modelLabel}
            activeId={videoModelId}
            options={STORYBOARD_VIDEO_MODEL_IDS.map((id) => ({
              id,
              label: getVideoModel(id).modelLabel,
              hint: `${videoCredits(
                storyboardVideoPricingKey(id, resolution),
                STORYBOARD_VIDEO_DURATION_SEC
              )} cr · 15s ${resolution}`,
            }))}
            onSelect={(id) => setVideoModelId(id as StoryboardVideoModelId)}
            disabled={loading}
          />
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm sm:p-5">
          {/* Storyboard picker */}
          <div className="mb-1 flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              <span className="text-purple-300">
                <ImageIcon className="h-3.5 w-3.5" />
              </span>
              Choose a storyboard
            </span>
          </div>

          {listState === "loading" ? (
            <div className="flex h-24 items-center gap-2 text-sm text-gray-500">
              <Loader2 className="h-4 w-4 animate-spin text-purple-300" />
              Loading your storyboards…
            </div>
          ) : listState === "error" ? (
            <div className="flex h-24 items-center gap-2 text-sm text-red-300">
              <AlertCircle className="h-4 w-4" /> Couldn&apos;t load your storyboards.
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1 text-sm text-gray-500">
                <span>You don&apos;t have any storyboards yet.</span>
                <a
                  href="/tools/photo-v2?type=storyboard"
                  className="font-semibold text-purple-300 hover:text-purple-200"
                >
                  Create one in Photo → Storyboard →
                </a>
              </div>
              <button
                type="button"
                disabled={loading}
                onClick={() => setShowUpload(true)}
                className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-white/[0.02] px-4 py-3 text-sm font-semibold text-gray-300 transition-colors hover:border-purple-400/50 hover:text-white disabled:opacity-40"
              >
                <Upload className="h-4 w-4" />
                Upload your own storyboard
              </button>
            </div>
          ) : (
            <div className="grid max-h-[320px] grid-cols-2 gap-3 overflow-y-auto pr-1 sm:grid-cols-3">
              <button
                type="button"
                disabled={loading}
                onClick={() => setShowUpload(true)}
                className="flex aspect-[3/2] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-white/20 bg-white/[0.02] text-gray-400 transition-colors hover:border-purple-400/50 hover:text-white disabled:opacity-40"
              >
                <Upload className="h-5 w-5" />
                <span className="text-[11px] font-semibold">Upload your own</span>
              </button>
              {items.map((s) => {
                const active = s.id === selectedId;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={loading}
                    onClick={() => setSelectedId(s.id)}
                    title={s.theme}
                    className={`group relative overflow-hidden rounded-xl border text-left transition-colors disabled:opacity-40 ${
                      active
                        ? "border-purple-400 ring-2 ring-purple-400/40"
                        : "border-white/10 hover:border-white/30"
                    }`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={s.storyboardUrl}
                      alt={s.theme}
                      className="aspect-[3/2] w-full object-cover"
                    />
                    <span className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-gray-300">
                      {s.aspectRatio && (
                        <span className="shrink-0 rounded bg-white/10 px-1 py-0.5 text-[9px] font-semibold text-gray-200">
                          {s.aspectRatio}
                        </span>
                      )}
                      <span className="truncate">{s.theme}</span>
                    </span>
                    {s.hasVideo && (
                      <span className="absolute left-1.5 top-1.5 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-300">
                        Has video
                      </span>
                    )}
                    {s.source === "uploaded" && (
                      <span className="absolute left-1.5 bottom-9 rounded-full bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-sky-300">
                        Uploaded
                      </span>
                    )}
                    {active && (
                      <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-purple-500 text-white">
                        <Check className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* Controls row */}
          <div className="mt-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <ChipDropdown
                square
                showChevron={false}
                icon={<Maximize2 className="h-3.5 w-3.5" />}
                value={resolution}
                activeId={resolution}
                tooltip="Video resolution. 720p is crisper but costs more credits. Clips are 15s."
                options={(["480p", "720p"] as const).map((r) => ({
                  id: r,
                  label: r,
                  hint: `${videoCredits(storyboardVideoPricingKey(videoModelId, r), STORYBOARD_VIDEO_DURATION_SEC)}`,
                }))}
                onSelect={(id) => setResolution(id as "480p" | "720p")}
                disabled={loading}
              />
              <ChipDropdown
                square
                showChevron={!aspectLocked}
                icon={<Crop className="h-3.5 w-3.5" />}
                value={aspect}
                activeId={aspect}
                tooltip={
                  aspectLocked
                    ? "Locked to your storyboard's orientation so the video can't flip vertical/horizontal."
                    : "Output orientation for this clip."
                }
                options={(["16:9", "9:16"] as const).map((a) => ({
                  id: a,
                  label: a,
                  hint: storyboardOrientationLabel(a),
                }))}
                onSelect={(id) => setAspect(id as StoryboardAspectRatio)}
                disabled={loading || aspectLocked}
              />
              <ChipDropdown
                icon={<Languages className="h-3.5 w-3.5" />}
                value={storyboardLanguageLabel(language)}
                activeId={language}
                tooltip="Spoken language for the video's dialogue. Defaults to the storyboard's language — change it to re-voice this storyboard in another language."
                options={STORYBOARD_LANGUAGES.map((l) => ({
                  id: l.id,
                  label: l.label,
                }))}
                onSelect={(id) => setLanguage(id as StoryboardLanguageId)}
                disabled={loading}
              />
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
                    <span>Create video</span>
                    <Wand2 className="h-4 w-4" />
                    <span className="text-sm font-extrabold">{cost}</span>
                  </>
                )}
              </button>
              {loading && (
                <button
                  type="button"
                  onClick={() => cancelSubmit()}
                  disabled={cancelling}
                  className="flex h-10 items-center justify-center gap-2 rounded-[4px] border border-red-500/40 bg-red-500/10 px-4 text-sm font-bold uppercase tracking-wide text-red-300 transition-all hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {cancelling ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Cancelling</span>
                    </>
                  ) : (
                    <span>Cancel</span>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Advanced: review / edit the Seedance prompt before rendering. */}
          {selectedId ? (
            <div className="mt-4 border-t border-white/10 pt-3">
              <button
                type="button"
                onClick={() => setAdvancedOpen((o) => !o)}
                className="flex w-full items-center gap-2 text-left text-xs font-semibold uppercase tracking-wider text-gray-400 transition-colors hover:text-gray-200"
              >
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                />
                <Pencil className="h-3.5 w-3.5 text-purple-300" />
                Advanced — edit prompt
                {promptDirty && (
                  <span className="rounded-full bg-purple-500/20 px-1.5 py-0.5 text-[9px] font-bold text-purple-200">
                    Edited
                  </span>
                )}
              </button>
              {advancedOpen && (
                <div className="mt-3">
                  <textarea
                    value={promptDraft}
                    onChange={(e) => setPromptDraft(e.target.value)}
                    rows={6}
                    disabled={loading}
                    placeholder="The video prompt Seedance will follow…"
                    className="w-full resize-y rounded-xl border border-white/10 bg-black/30 p-3 text-xs leading-relaxed text-gray-200 placeholder:text-gray-600 focus:border-purple-400/40 focus:outline-none"
                  />
                  <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] text-gray-500">
                    <span>
                      Style, orientation &amp; language are re-applied automatically on render.
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={
                          promptDraft.length > SEEDANCE_PROMPT_BODY_BUDGET_CHARS
                            ? "font-semibold text-amber-300"
                            : "text-gray-500"
                        }
                        title={`Keep the prompt under ~${SEEDANCE_PROMPT_BODY_BUDGET_CHARS} characters so style, orientation & language can be added without the video model truncating it.`}
                      >
                        {promptDraft.length}/{SEEDANCE_PROMPT_BODY_BUDGET_CHARS}
                      </span>
                      {promptDirty && (
                        <button
                          type="button"
                          onClick={() => setPromptDraft(storedPrompt)}
                          className="font-semibold text-gray-400 hover:text-gray-200"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                  </div>
                  {promptDraft.length > SEEDANCE_PROMPT_BODY_BUDGET_CHARS && (
                    <p className="mt-1 text-[11px] text-amber-300/80">
                      This prompt is long — it may be trimmed at a sentence boundary on render so the style, orientation &amp; language directives still fit. Shorten it for full fidelity.
                    </p>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {!selectedId && listState === "loaded" && items.length > 0 ? (
            <p className="mt-3 pl-1 text-xs text-amber-300/80">
              Pick a storyboard to turn into a video.
            </p>
          ) : null}
        </div>
      </form>

      {showUpload && (
        <ImportStoryboardModal
          onClose={() => setShowUpload(false)}
          onImported={handleImported}
        />
      )}

      {error && (
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-gray-300">
          <Loader2 className="h-5 w-5 animate-spin text-purple-400" />
          Rendering your storyboard into a 15s clip — it will appear below when ready.
        </div>
      )}

      {resultUrl && !loading && (
        <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 sm:flex-row">
          <video
            src={resultUrl}
            controls
            playsInline
            className={`shrink-0 rounded-2xl border border-white/10 bg-black ${
              aspect === "9:16" ? "w-full max-w-[260px]" : "w-full max-w-md"
            }`}
          />
          <div className="min-w-0">
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
              <Check className="h-3 w-3" />
              Saved to your library
            </div>
            <p className="text-sm text-gray-300">
              {storyboardVideoModel.modelLabel} · 15s · {resolution} · {aspect} {storyboardOrientationLabel(aspect)} · {storyboardLanguageLabel(language)}
              {selected ? ` · ${selected.theme}` : ""}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Find it in your history below, or render another resolution.
            </p>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Reels Creator sub-tool. Consolidates the legacy ReelsGen Veo + Seedance page
// into one composer that POSTs to the unified /api/generate-reels route. Engine
// (Seedance 2 Fast | Veo 3.1 Lite) is the "model" chip; Veo adds a Mode chip (Single | Per
// scene). Adaptive controls + narrator + caption styler + a live caption preview
// whose 480x854 math mirrors the ASS MarginV math on the server.
// ---------------------------------------------------------------------------

// MiniMax speech-02-turbo English voice catalogue (storytelling voices first).
const REELS_ENGLISH_VOICES = [
  "English_CaptivatingStoryteller",
  "English_WiseScholar",
  "English_Wiselady",
  "English_Steadymentor",
  "English_MaturePartner",
  "English_Trustworth_Man",
  "English_Deep-VoicedGentleman",
  "English_ManWithDeepVoice",
  "English_Gentle-voiced_man",
  "English_Diligent_Man",
  "English_PatientMan",
  "English_DecentYoungMan",
  "English_ReservedYoungMan",
  "English_FriendlyPerson",
  "English_MatureBoss",
  "English_BossyLeader",
  "English_Debator",
  "English_ImposingManner",
  "English_PassionateWarrior",
  "English_Comedian",
  "English_Jovialman",
  "English_Aussie_Bloke",
  "English_ConfidentWoman",
  "English_AssertiveQueen",
  "English_Graceful_Lady",
  "English_CalmWoman",
  "English_SereneWoman",
  "English_SentimentalLady",
  "English_StressedLady",
  "English_LovelyGirl",
  "English_Kind-heartedGirl",
  "English_Soft-spokenGirl",
  "English_PlayfulGirl",
  "English_WhimsicalGirl",
  "English_Whispering_girl",
  "English_UpsetGirl",
  "English_SadTeen",
  "English_Strong-WilledBoy",
  "English_AnimeCharacter",
];

const REELS_EMOTIONS = [
  "auto",
  "happy",
  "sad",
  "angry",
  "fearful",
  "disgusted",
  "surprised",
  "calm",
  "fluent",
  "neutral",
];

const REELS_CAPTION_FONTS = ["Arial", "Poppins", "Montserrat", "Bangers"];

const humanizeReelsVoice = (id: string) =>
  id
    .replace(/^English_/, "")
    .replace(/[_-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

const humanizeReelsEmotion = (e: string) =>
  e === "auto" ? "Auto (let AI decide)" : e.charAt(0).toUpperCase() + e.slice(1);

type ReelsCaptionStyle = {
  fontname: string;
  fontsize: number;
  primaryColor: string;
  highlightColor: string;
  outlineColor: string;
  outlineThickness: number;
  marginV: number;
  highlightOnly: boolean;
};

// Themed dropdown replacing the native <select> in the caption styler. Matches
// the studio's dark/glass aesthetic and previews each font in its own typeface.
function ThemedSelect({
  value,
  options,
  onChange,
  disabled,
  previewFont = false,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  previewFont?: boolean;
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
        className={`flex w-full items-center justify-between gap-2 rounded-xl border bg-black/30 p-2.5 text-left text-sm text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
          open ? "border-purple-400/50 bg-purple-500/10" : "border-white/10 hover:border-white/25"
        }`}
      >
        <span style={previewFont ? { fontFamily: `"${value}", sans-serif` } : undefined}>
          {value}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-50 mt-2 overflow-hidden rounded-xl border border-white/10 bg-[#0b1020] p-1.5 shadow-2xl shadow-black/50">
          {options.map((opt) => {
            const active = opt === value;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  onChange(opt);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  active ? "bg-purple-500/20 text-white" : "text-gray-300 hover:bg-white/5"
                }`}
                style={previewFont ? { fontFamily: `"${opt}", sans-serif` } : undefined}
              >
                {opt}
                {active && <Check className="h-4 w-4 shrink-0 text-purple-400" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Themed numeric stepper replacing the native number input (whose spin buttons
// don't respect the app theme). Keeps the field typeable; −/+ clamp to min/max.
function NumberStepper({
  value,
  onChange,
  min = 0,
  max = 999,
  step = 1,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const set = (n: number) => {
    if (!Number.isNaN(n)) onChange(clamp(n));
  };
  return (
    <div className="flex items-stretch overflow-hidden rounded-xl border border-white/10 bg-black/30 transition-colors focus-within:border-purple-400/40">
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => set(value - step)}
        aria-label="Decrease"
        className="flex w-10 shrink-0 items-center justify-center text-gray-300 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Minus className="h-4 w-4" />
      </button>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
        className="w-full min-w-0 border-x border-white/10 bg-transparent p-2.5 text-center text-sm font-semibold text-white focus:outline-none disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
      />
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => set(value + step)}
        aria-label="Increase"
        className="flex w-10 shrink-0 items-center justify-center text-gray-300 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function ReelsCreatorComposer({
  onSelectCreation,
  onGenerated,
}: {
  onSelectCreation: (id: string) => void;
  onGenerated: () => void;
}) {
  const { videoCredits } = usePricing();
  const { begin: beginSubmit, cancel: cancelSubmit, cancelling } = useIdempotentSubmit();

  // Engine + (Veo-only) mode.
  const [engine, setEngine] = useState<ReelsEngine>("seedance");
  const [veoMode, setVeoMode] = useState<ReelsVeoMode>("single");

  // Shared.
  const [theme, setTheme] = useState("");
  const [voiceId, setVoiceId] = useState<string>(DEFAULT_VOICE_ID);
  const [emotion, setEmotion] = useState("auto");

  // Seedance controls.
  const [numScenes, setNumScenes] = useState(1);
  const [durationPerScene, setDurationPerScene] = useState(5);
  const [resolution, setResolution] = useState<SeedanceResolution>("480p");

  // Veo controls.
  const [veoDuration, setVeoDuration] = useState<4 | 6 | 8>(6);
  const [veoResolution, setVeoResolution] = useState<VeoResolution>("720p");
  const [singlePromptScenes, setSinglePromptScenes] = useState<1 | 2>(1);
  const [veoNumScenes, setVeoNumScenes] = useState(1);

  const [captionStyle, setCaptionStyle] = useState<ReelsCaptionStyle>({
    fontname: "Poppins",
    fontsize: 60,
    primaryColor: "#FFFFFF",
    highlightColor: "#FFFF00",
    outlineColor: "#000000",
    outlineThickness: 4,
    marginV: 15,
    highlightOnly: true,
  });

  const [loading, setLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 1080p forces an 8s clip (Veo 3.1 Lite constraint) — keep state valid.
  const onVeoResolution = (r: VeoResolution) => {
    setVeoResolution(r);
    if (r === "1080p") setVeoDuration(8);
  };

  const totalDuration = reelsTotalDurationSec({
    engine,
    mode: veoMode,
    durationPerScene,
    numScenes: engine === "seedance" ? numScenes : veoNumScenes,
    veoDuration,
  });
  const pricingKey = reelsPricingKey(
    engine,
    engine === "seedance" ? resolution : veoResolution
  );
  const cost = videoCredits(pricingKey, totalDuration);

  const canGenerate = !loading && theme.trim().length > 0;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canGenerate) return;

    const body: Record<string, unknown> =
      engine === "seedance"
        ? {
            engine: "seedance",
            theme: theme.trim(),
            numScenes: Number(numScenes),
            durationPerScene: Number(durationPerScene),
            resolution,
            voiceId,
            emotion,
            captionStyle,
          }
        : {
            engine: "veo",
            mode: veoMode,
            theme: theme.trim(),
            duration: veoDuration,
            resolution: veoResolution,
            voiceId,
            emotion,
            captionStyle,
            ...(veoMode === "single"
              ? { singlePromptScenes }
              : { numScenes: Number(veoNumScenes) }),
          };

    // Stable key per attempt + synchronous in-flight lock (see hook docs).
    const attempt = beginSubmit(`reels-${engine}:${JSON.stringify(body)}`);
    if (!attempt) return;

    setLoading(true);
    setError(null);
    setResultUrl(null);

    try {
      const response = await fetch("/api/generate-reels", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (!response.ok) {
        // User cancellation → back to idle (credits refunded), not a red error.
        if (data.code === "GENERATION_CANCELLED") {
          attempt.settle(false);
          setError(null);
          onGenerated();
          return;
        }
        if (response.status === 402) {
          throw new Error(
            `Insufficient credits. Required: ${data.requiredCredits ?? cost}, current: ${data.currentBalance ?? 0}.`
          );
        }
        const idemMsg = describeIdempotencyError(response.status, data);
        if (idemMsg) throw new Error(idemMsg);
        throw new Error(data.error || "Failed to generate video");
      }

      attempt.settle(true);
      setResultUrl(data.videoUrl);
      onGenerated();
    } catch (err: unknown) {
      attempt.settle(false);
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Adaptive control chips per engine/mode.
  const veoDurations = veoResolution === "1080p" ? [8] : [4, 6, 8];

  return (
    <>
      <form onSubmit={handleGenerate} className="relative z-20 mt-10">
        {/* Top-left chips: creation type + engine (+ Veo mode) */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <ChipDropdown
            icon={<Layers className="h-3.5 w-3.5" />}
            value="Reels Creator"
            activeId="reels-creator"
            options={CREATION_TYPES.map((c) => ({ id: c.id, label: c.label }))}
            onSelect={onSelectCreation}
            disabled={loading}
          />
          <ChipDropdown
            icon={<Cpu className="h-3.5 w-3.5" />}
            value={reelsEngineLabel(engine)}
            activeId={engine}
            options={REELS_ENGINES.map((e) => ({ id: e.id, label: e.label }))}
            onSelect={(id) => setEngine(id as ReelsEngine)}
            disabled={loading}
          />
          {engine === "veo" && (
            <ChipDropdown
              icon={<Film className="h-3.5 w-3.5" />}
              value={veoMode === "single" ? "Single video" : "Per scene"}
              activeId={veoMode}
              options={[
                { id: "single", label: "Single video" },
                { id: "perScene", label: "Per scene" },
              ]}
              onSelect={(id) => setVeoMode(id as ReelsVeoMode)}
              disabled={loading}
            />
          )}
        </div>

        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 backdrop-blur-sm transition-colors focus-within:border-purple-400/40 sm:p-5">
          {/* Theme */}
          <textarea
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            placeholder="Describe your reel — e.g., The history of space exploration in 60 seconds. Our AI writes the script, scenes, narration, and captions."
            rows={3}
            disabled={loading}
            className="min-h-[64px] w-full resize-none bg-transparent text-base text-white placeholder:text-gray-500 focus:outline-none"
          />

          {/* Controls row */}
          <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {engine === "seedance" ? (
                <>
                  <ChipDropdown
                    square
                    showChevron={false}
                    icon={<Layers className="h-3.5 w-3.5" />}
                    value={`${numScenes} scene${numScenes > 1 ? "s" : ""}`}
                    activeId={String(numScenes)}
                    tooltip="How many scenes to break the story into. More scenes = a longer reel."
                    options={[1, 2, 3].map((n) => ({
                      id: String(n),
                      label: `${n} scene${n > 1 ? "s" : ""}`,
                      hint: `${videoCredits(reelsPricingKey("seedance", resolution), n * durationPerScene)}`,
                    }))}
                    onSelect={(id) => setNumScenes(Number(id))}
                    disabled={loading}
                  />
                  <ChipDropdown
                    square
                    showChevron={false}
                    icon={<Clock className="h-3.5 w-3.5" />}
                    value={`${durationPerScene}s / scene`}
                    activeId={String(durationPerScene)}
                    tooltip="Seconds per scene. Total reel length = scenes × this."
                    options={[5, 10].map((d) => ({
                      id: String(d),
                      label: `${d} seconds / scene`,
                      hint: `${videoCredits(reelsPricingKey("seedance", resolution), numScenes * d)}`,
                    }))}
                    onSelect={(id) => setDurationPerScene(Number(id))}
                    disabled={loading}
                  />
                  <ChipDropdown
                    square
                    showChevron={false}
                    icon={<Maximize2 className="h-3.5 w-3.5" />}
                    value={resolution}
                    activeId={resolution}
                    tooltip="Video resolution. 720p is crisper but costs more credits."
                    options={(["480p", "720p"] as const).map((r) => ({
                      id: r,
                      label: r === "480p" ? "480p (Fast)" : "720p (HD)",
                      hint: `${videoCredits(reelsPricingKey("seedance", r), totalDuration)}`,
                    }))}
                    onSelect={(id) => setResolution(id as SeedanceResolution)}
                    disabled={loading}
                  />
                </>
              ) : (
                <>
                  <ChipDropdown
                    square
                    showChevron={false}
                    icon={<Clock className="h-3.5 w-3.5" />}
                    value={
                      veoMode === "perScene"
                        ? `${veoDuration}s / scene`
                        : `${veoDuration}s clip`
                    }
                    activeId={String(veoDuration)}
                    tooltip={
                      veoMode === "perScene"
                        ? "Seconds per scene. Total ≈ scenes × this."
                        : "Length of the single Veo clip."
                    }
                    options={veoDurations.map((d) => ({
                      id: String(d),
                      label:
                        veoMode === "perScene"
                          ? `${d} seconds / scene`
                          : `${d} seconds`,
                    }))}
                    onSelect={(id) => setVeoDuration(Number(id) as 4 | 6 | 8)}
                    disabled={loading || veoResolution === "1080p"}
                  />
                  <ChipDropdown
                    square
                    showChevron={false}
                    icon={<Maximize2 className="h-3.5 w-3.5" />}
                    value={veoResolution}
                    activeId={veoResolution}
                    tooltip="Video resolution. 1080p requires an 8s clip (Veo 3.1 Lite constraint)."
                    options={(["720p", "1080p"] as const).map((r) => ({
                      id: r,
                      label: r === "1080p" ? "1080p (8s only)" : "720p",
                    }))}
                    onSelect={(id) => onVeoResolution(id as VeoResolution)}
                    disabled={loading}
                  />
                  {veoMode === "single" ? (
                    <ChipDropdown
                      square
                      showChevron={false}
                      icon={<Film className="h-3.5 w-3.5" />}
                      value={singlePromptScenes === 2 ? "2 scenes / prompt" : "1 scene"}
                      activeId={String(singlePromptScenes)}
                      tooltip="How Gemini structures the single Veo prompt — still one generated video."
                      options={[
                        { id: "1", label: "1 continuous scene" },
                        { id: "2", label: "2 scenes + cut (one call)" },
                      ]}
                      onSelect={(id) => setSinglePromptScenes(Number(id) as 1 | 2)}
                      disabled={loading}
                    />
                  ) : (
                    <ChipDropdown
                      square
                      showChevron={false}
                      icon={<Layers className="h-3.5 w-3.5" />}
                      value={`${veoNumScenes} scene${veoNumScenes > 1 ? "s" : ""}`}
                      activeId={String(veoNumScenes)}
                      tooltip="Scene count multiplies with seconds-per-scene for total run time."
                      options={[1, 2, 3].map((n) => ({
                        id: String(n),
                        label: `${n} scene${n > 1 ? "s" : ""}`,
                      }))}
                      onSelect={(id) => setVeoNumScenes(Number(id))}
                      disabled={loading}
                    />
                  )}
                </>
              )}

              {/* Narrator: voice + emotion (shared) */}
              <ChipDropdown
                icon={<Mic className="h-3.5 w-3.5" />}
                value={humanizeReelsVoice(voiceId)}
                activeId={voiceId}
                tooltip="The narrator's MiniMax voice."
                options={REELS_ENGLISH_VOICES.map((v) => ({
                  id: v,
                  label: humanizeReelsVoice(v),
                }))}
                onSelect={(id) => setVoiceId(id)}
                disabled={loading}
              />
              <ChipDropdown
                icon={<Smile className="h-3.5 w-3.5" />}
                value={humanizeReelsEmotion(emotion)}
                activeId={emotion}
                tooltip={
                  engine === "veo"
                    ? 'Spoken delivery mood. "Auto" maps to neutral for Veo.'
                    : 'Spoken delivery mood. "Auto" lets the AI pick a mood for the theme.'
                }
                options={REELS_EMOTIONS.map((em) => ({
                  id: em,
                  label: humanizeReelsEmotion(em),
                }))}
                onSelect={(id) => setEmotion(id)}
                disabled={loading}
              />
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
                    <span className="text-sm font-extrabold">{cost}</span>
                  </>
                )}
              </button>
              {loading && (
                <button
                  type="button"
                  onClick={() => cancelSubmit()}
                  disabled={cancelling}
                  className="flex h-10 items-center justify-center gap-2 rounded-[4px] border border-red-500/40 bg-red-500/10 px-4 text-sm font-bold uppercase tracking-wide text-red-300 transition-all hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {cancelling ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Cancelling</span>
                    </>
                  ) : (
                    <span>Cancel</span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Caption styler + live preview */}
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
          <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-gray-400">
              <Type className="h-3.5 w-3.5 text-purple-300" />
              Caption style
            </div>
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    Font family
                  </label>
                  <ThemedSelect
                    value={captionStyle.fontname}
                    options={REELS_CAPTION_FONTS}
                    onChange={(v) => setCaptionStyle({ ...captionStyle, fontname: v })}
                    disabled={loading}
                    previewFont
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    Font size
                  </label>
                  <NumberStepper
                    value={captionStyle.fontsize}
                    onChange={(v) => setCaptionStyle({ ...captionStyle, fontsize: v })}
                    min={8}
                    max={200}
                    step={2}
                    disabled={loading}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                      Text color
                    </label>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-1.5">
                      <input
                        type="color"
                        value={captionStyle.highlightColor}
                        onChange={(e) =>
                          setCaptionStyle({ ...captionStyle, highlightColor: e.target.value })
                        }
                        disabled={loading}
                        className="h-8 w-8 cursor-pointer rounded-lg border-none bg-transparent"
                      />
                      <span className="font-mono text-[11px] text-gray-300">
                        {captionStyle.highlightColor}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                      Outline
                    </label>
                    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 p-1.5">
                      <input
                        type="color"
                        value={captionStyle.outlineColor}
                        onChange={(e) =>
                          setCaptionStyle({ ...captionStyle, outlineColor: e.target.value })
                        }
                        disabled={loading}
                        className="h-8 w-8 cursor-pointer rounded-lg border-none bg-transparent"
                      />
                      <span className="font-mono text-[11px] text-gray-300">
                        {captionStyle.outlineColor}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                    Outline thickness
                  </label>
                  <NumberStepper
                    value={captionStyle.outlineThickness}
                    onChange={(v) =>
                      setCaptionStyle({ ...captionStyle, outlineThickness: v })
                    }
                    min={0}
                    max={20}
                    step={1}
                    disabled={loading}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                      Vertical position
                    </label>
                    <span className="text-[11px] font-bold text-purple-300">
                      {captionStyle.marginV}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={captionStyle.marginV}
                    onChange={(e) =>
                      setCaptionStyle({ ...captionStyle, marginV: Number(e.target.value) })
                    }
                    disabled={loading}
                    className="w-full accent-purple-500"
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-3 pt-1">
                  <input
                    type="checkbox"
                    checked={captionStyle.highlightOnly}
                    onChange={(e) =>
                      setCaptionStyle({ ...captionStyle, highlightOnly: e.target.checked })
                    }
                    disabled={loading}
                    className="h-4 w-4 cursor-pointer rounded border-white/10 bg-black/30 accent-purple-600"
                  />
                  <span className="text-sm font-semibold text-gray-300">
                    Highlight only mode
                  </span>
                </label>
              </div>
            </div>
          </div>

          {/* Live Caption Preview — 480x854 math mirrors the server ASS MarginV. */}
          <div className="rounded-3xl border border-white/10 bg-black/40 p-4 sm:p-5">
            <div className="mb-3 text-center text-[10px] font-bold uppercase tracking-[0.3em] text-gray-500">
              Live caption preview
            </div>
            {engine === "veo" && (
              <p className="mx-auto mb-3 max-w-[240px] text-center text-[10px] leading-relaxed text-amber-400/80">
                Preview uses 480×854 math; Veo outputs 720p/1080p so vertical caption
                position may differ slightly.
              </p>
            )}
            <style
              dangerouslySetInnerHTML={{
                __html:
                  "@import url('https://fonts.googleapis.com/css2?family=Bangers&family=Montserrat:wght@700&family=Poppins:wght@800&display=swap');",
              }}
            />
            {(() => {
              const FONT_METRIC_SCALES: Record<string, number> = {
                Arial: 0.87,
                Poppins: 0.86,
                Montserrat: 0.86,
                Bangers: 0.65,
              };
              const DESCENDER_OFFSET_SCALES: Record<string, number> = {
                Arial: 0.08,
                Poppins: 0.08,
                Montserrat: 0.08,
                Bangers: 0.12,
              };
              const metricScale = FONT_METRIC_SCALES[captionStyle.fontname] || 0.85;
              const offsetScale = DESCENDER_OFFSET_SCALES[captionStyle.fontname] || 0.08;
              return (
                <div className="relative mx-auto aspect-[9/16] w-[220px] overflow-hidden rounded-[2rem] border-[6px] border-white/10 bg-slate-900 shadow-inner">
                  <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60" />
                  <div
                    className="pointer-events-none absolute left-0 flex w-full justify-center px-4 transition-all duration-300"
                    style={{
                      bottom: `calc(${(captionStyle.marginV * (854 - captionStyle.fontsize * 1.5)) / 854}% + ${captionStyle.fontsize * (220 / 480) * offsetScale}px)`,
                    }}
                  >
                    <div
                      className="relative text-center font-extrabold uppercase leading-none tracking-tight"
                      style={{
                        fontFamily: `"${captionStyle.fontname}", sans-serif`,
                        fontSize: `${captionStyle.fontsize * (220 / 480) * metricScale}px`,
                      }}
                    >
                      <div
                        className="absolute inset-0 z-0"
                        style={{
                          WebkitTextStroke: `${captionStyle.outlineThickness * (220 / 480) * 1.5}px ${captionStyle.outlineColor}`,
                          color: captionStyle.outlineColor,
                        }}
                      >
                        BREATHTAKING
                      </div>
                      <div className="relative z-10" style={{ color: captionStyle.highlightColor }}>
                        BREATHTAKING
                      </div>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
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
          Writing the script, generating scenes, narration &amp; captions — this can take a
          few minutes. It will appear below when ready.
        </div>
      )}

      {resultUrl && !loading && (
        <div className="mt-6 flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/5 p-4 sm:flex-row">
          <video
            src={resultUrl}
            controls
            playsInline
            className="w-full max-w-[260px] shrink-0 rounded-2xl border border-white/10 bg-black"
          />
          <div className="min-w-0 flex-1">
            <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300">
              <Check className="h-3 w-3" />
              Saved to your library
            </div>
            <p className="text-sm text-gray-300">
              {engine === "veo"
                ? `${reelsEngineLabel("veo")} · ${veoMode === "single" ? "Single" : "Per scene"} · ${veoResolution} · ${totalDuration}s`
                : `${reelsEngineLabel("seedance")} · ${numScenes} scene${numScenes > 1 ? "s" : ""} · ${resolution} · ${totalDuration}s`}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <a
                href={resultUrl}
                download
                className="inline-flex items-center gap-2 rounded-[4px] border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-white/10"
              >
                <Download className="h-4 w-4" />
                Download
              </a>
              <a
                href={`/tools/scheduler?assetUrl=${encodeURIComponent(resultUrl)}${
                  theme.trim() ? `&title=${encodeURIComponent(theme.trim())}` : ""
                }`}
                className="inline-flex items-center gap-2 rounded-[4px] bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition-colors hover:bg-emerald-500"
              >
                <CalendarClock className="h-4 w-4" />
                Schedule to YouTube
              </a>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
