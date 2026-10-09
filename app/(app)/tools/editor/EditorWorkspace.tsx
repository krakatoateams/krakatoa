"use client";

import EditorExportDialog from "./EditorExportDialog";
import type { EditorExportSettings } from "@/lib/editor-export-settings";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Info,
  Eye,
  EyeOff,
  ImagePlus,
  Lock,
  Pause,
  Play,
  Plus,
  Maximize2,
  Repeat,
  Scissors,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Trash2,
  Type,
  Unlock,
  Upload,
  Video,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useSignedMediaUrl } from "@/lib/use-signed-media-url";
import { useIdempotentSubmit } from "@/lib/use-idempotent-submit";
import {
  clearPersistedIdempotentAttempt,
  readPersistedIdempotentAttempt,
} from "@/lib/idempotent-submit-state";
import { monotonicPct, parseExportProgress } from "@/lib/editor-export-progress";
import {
  EditorExportProgressDialog,
  type ExportProgressState,
} from "./EditorExportProgressDialog";
import { canDropOnEditor } from "@/lib/editor-handoff";
import { uploadRefFile } from "@/components/studio/RefGroup";
import { useStudioGenerationPreview } from "@/components/studio";
import { fetchSignedUrl } from "@/lib/storage-sign-client";
import { probeVideoDurationSec } from "@/lib/use-video-duration";
import { getLocalMedia, localMediaKey, putLocalMedia } from "@/lib/editor-local-media";
import type { CreationHistoryItem } from "@/lib/creations";
import {
  DEFAULT_EDITOR_TITLE,
  EDITOR_ASPECTS,
  EDITOR_CANVAS,
  EDITOR_MAX_DURATION_SEC,
  EDITOR_MAX_OVERLAYS,
  EDITOR_MAX_SEQUENCE,
  EDITOR_MAX_UPLOAD_MB,
  validateEditorUploadFile,
  canSplitClip,
  canTrimClipEnd,
  canTrimClipStart,
  LAYER_NAME_MAX,
  clampClipToComposition,
  clampOverlayToComposition,
  clipAtPlayhead,
  clipsAtPlayhead,
  clipLayerDurationSec,
  clipSourceOutSec,
  emptyEditorDocument,
  isLocalOnlyLayer,
  isPlaceholderSpan,
  maxClipLayerDurationSec,
  maxOverlayLayerDurationSec,
  trimStartBy,
  normalizeEditorTitle,
  normalizeLayerName,
  parseEditorDocument,
  reorderById,
  resolveLayerLabel,
  sequenceDurationSec,
  sortedOverlays,
  sortedSequence,
  splitEditorClip,
  textOverlayLayout,
  trimClipEndToPlayhead,
  trimClipStartToPlayhead,
  validateEditorExport,
  withProbedClipSource,
  withProbedLayerSource,
  withProbedOverlaySource,
  withProjectAspect,
  type EditorClip,
  type EditorDocument,
  type EditorOverlay,
} from "@/lib/editor-document";
import { Poppins } from "next/font/google";
import { containSize } from "@/lib/editor-preview-size";
import {
  DEFAULT_PX_PER_SEC,
  MAX_PX_PER_SEC,
  MIN_PX_PER_SEC,
  TIMELINE_PAD_PX,
  ZOOM_STEP,
  anchoredScrollLeft,
  clampScale,
  FIT_MARGIN_SEC,
  fitPxPerSec,
  openFitPxPerSec,
  formatRulerLabel,
  rulerIntervalSec,
  stepScale,
  visibleTickRange,
} from "@/lib/editor-timeline-zoom";
import { useClipFilmstrip } from "./useClipFilmstrip";
import { useEditorViewport } from "./useEditorViewport";
import EditorPreviewToolbar, { type EditorTool } from "./EditorPreviewToolbar";
import EditorTopBar from "./EditorTopBar";
import { useEditorLibrary } from "./EditorLibraryPicker";
import EditorSavedList from "./EditorSavedList";

const poppins = Poppins({
  weight: "800",
  subsets: ["latin"],
  display: "swap",
});

function newId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
}

function formatTimecode(sec: number): string {
  const clamped = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped - minutes * 60;
  if (minutes <= 0) return `${seconds.toFixed(1)}s`;
  return `${minutes}:${seconds.toFixed(1).padStart(4, "0")}`;
}

/** Timeline times snap to 0.1s so trim/position stays on one decimal. */
function snapTenth(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

const LAYER_PANEL_MIN_WIDTH = 128;
const LAYER_PANEL_MAX_WIDTH = 320;
const LAYER_PANEL_DEFAULT_WIDTH = 176;
/** Smallest usable preview canvas edge, e.g. below the stage size on a very narrow viewport. */
const EDITOR_PREVIEW_MIN_PX = 160;

const TIMELINE_TRACKS_MIN_HEIGHT = 140;
const TIMELINE_TRACKS_MAX_HEIGHT = 420;
const TIMELINE_TRACKS_DEFAULT_HEIGHT = 180;
// Ruler lives outside the vertically-scrolling rows so it stays pinned in view;
// its own height is carved out of tracksHeight to keep the resizable split intact.
const TIMELINE_RULER_HEIGHT = 36;

/** Ruler ticks render for the visible range snapped to buckets of this width. */
const RULER_BUCKET_PX = 400;

const HISTORY_LIMIT = 50;
const HISTORY_COALESCE_MS = 650;

/** Zoom is frozen while a drag runs so the drag keeps the scale it started with. */
let activeTimelineDrags = 0;

function startTimelineDrag(
  event: ReactPointerEvent,
  pxPerSec: number,
  onMove: (deltaSec: number) => void
): void {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  activeTimelineDrags += 1;
  const move = (ev: PointerEvent) => {
    onMove((ev.clientX - startX) / pxPerSec);
  };
  const up = () => {
    activeTimelineDrags = Math.max(0, activeTimelineDrags - 1);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
}

const LAYER_ROW_ATTR = "data-layer-row";

function layerRowIdAt(clientX: number, clientY: number): string | null {
  const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
  const row = el?.closest(`[${LAYER_ROW_ATTR}]`) as HTMLElement | null;
  return row?.dataset.layerId ?? null;
}

/**
 * Reorders layer rows by tracking the pointer directly instead of native HTML5
 * drag-and-drop: native DnD only reliably completes a small fraction of real
 * drags in this app (Chromium silently drops the session after one dragover,
 * worse in Safari), while plain pointermove/pointerup — already used for
 * timeline trim/move — never misses a drop.
 */
function startLayerReorderDrag(
  event: ReactPointerEvent,
  onHover: (targetId: string | null) => void,
  onCommit: (targetId: string | null) => void
): void {
  event.preventDefault();
  const move = (ev: PointerEvent) => onHover(layerRowIdAt(ev.clientX, ev.clientY));
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    onCommit(layerRowIdAt(ev.clientX, ev.clientY));
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

/** Best-effort removal of temp ref uploads; the 24 h temp sweep is the backstop. */
function deleteRefUploads(paths: string[]): void {
  for (const path of paths) {
    void fetch("/api/upload/ref/sign", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    }).catch(() => undefined);
  }
}

function exportTimestampName(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}`;
}

function fingerprintOf(title: string, doc: EditorDocument): string {
  return JSON.stringify({ title: normalizeEditorTitle(title), document: doc });
}

/** New layers start at the playhead; the project grows to fit them, up to the cap. */
function placeLayer(playheadSec: number, span: number): { start: number; end: number } {
  const start = snapTenth(Math.max(0, Math.min(playheadSec, EDITOR_MAX_DURATION_SEC - span)));
  return { start, end: snapTenth(start + span) };
}

function newClipLayer(
  source: { creationId: string | null; storagePath: string | null; localMediaId?: string | null },
  order: number,
  playheadSec: number
): EditorClip {
  // Placeholder span until the source length is probed (see withProbedClipSource).
  const { start, end } = placeLayer(playheadSec, 3);
  return {
    id: newId("clip"),
    creationId: source.creationId,
    storagePath: source.storagePath,
    localMediaId: source.localMediaId ?? null,
    startSec: start,
    endSec: end,
    inSec: 0,
    sourceDurationSec: null,
    order,
    locked: false,
    hidden: false,
    muted: false,
  };
}

function clipFromLibrary(item: CreationHistoryItem, order: number, playheadSec: number): EditorClip {
  return newClipLayer(
    { creationId: item.id, storagePath: item.storagePath?.trim() || null },
    order,
    playheadSec
  );
}

function clipFromDevice(localMediaId: string, order: number, playheadSec: number): EditorClip {
  return newClipLayer({ creationId: null, storagePath: null, localMediaId }, order, playheadSec);
}

function TimelineLayerRow({
  selected,
  locked,
  hidden,
  startSec,
  endSec,
  pxPerSec,
  trackWidth,
  laneWidth,
  maxEnd,
  maxSpan,
  inSec,
  label,
  selectedClassName,
  onSelect,
  onMove,
  onTrimStart,
  onTrimEnd,
  filmstrip,
}: {
  selected: boolean;
  locked: boolean;
  hidden: boolean;
  startSec: number;
  endSec: number;
  pxPerSec: number;
  /** Full scrollable width, including drag headroom past the project end. */
  trackWidth: number;
  /** Filled lane width: ends exactly at the project end. */
  laneWidth: number;
  maxEnd: number;
  maxSpan: number;
  /** Source in-point for video layers; undefined when the layer has no source. */
  inSec?: number;
  label: ReactNode;
  selectedClassName: string;
  onSelect: () => void;
  onMove: (startSec: number, endSec: number) => void;
  onTrimStart: (startSec: number, inSec?: number) => void;
  onTrimEnd: (endSec: number) => void;
  /** Video layers: source range to show as a frame strip behind the label. */
  filmstrip?: { storagePath: string | null; localUrl: string | null; inSec: number; outSec: number };
}) {
  const span = Math.max(0.2, endSec - startSec);
  const width = Math.max(28, span * pxPerSec);
  const frames = useClipFilmstrip(
    filmstrip?.storagePath,
    filmstrip?.localUrl,
    filmstrip?.inSec ?? 0,
    filmstrip?.outSec ?? 0,
    width
  );
  const nudgeKey = (edge: "start" | "end") => (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    const step = (event.shiftKey ? 1 : 0.1) * (event.key === "ArrowLeft" ? -1 : 1);
    if (edge === "start") {
      const next = trimStartBy(startSec, endSec, inSec, step);
      onTrimStart(next.startSec, next.inSec);
    } else {
      onTrimEnd(Math.max(startSec + 0.2, Math.min(Math.min(maxEnd, startSec + maxSpan), snapTenth(endSec + step))));
    }
  };
  return (
    <div className="relative h-8" style={{ width: trackWidth }}>
      <div className="absolute inset-y-0 left-0 rounded-sm bg-white/[0.03]" style={{ width: laneWidth }} />
      <div
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onPointerDown={(event) => {
          if (locked) return;
          if ((event.target as HTMLElement).dataset.trim) return;
          const origStart = startSec;
          const origEnd = endSec;
          const origSpan = Math.max(0.2, origEnd - origStart);
          startTimelineDrag(event, pxPerSec, (delta) => {
            const nextStart = Math.max(0, Math.min(maxEnd - origSpan, origStart + delta));
            onMove(nextStart, nextStart + origSpan);
          });
        }}
        className={`absolute inset-y-0 flex items-center rounded-md ${
          locked ? "cursor-default" : "cursor-grab active:cursor-grabbing"
        } ${hidden ? "opacity-40" : ""} ${selected ? selectedClassName : "bg-white/10"}`}
        style={{ left: startSec * pxPerSec, width }}
      >
        {frames ? (
          <span
            aria-hidden
            className={`pointer-events-none absolute inset-0 flex overflow-hidden rounded-md ${selected ? "opacity-60" : ""}`}
          >
            {frames.map((src, i) => (
              // eslint-disable-next-line @next/next/no-img-element -- in-memory data URL frames
              <img key={i} src={src} alt="" draggable={false} className="h-full min-w-0 flex-1 object-cover" />
            ))}
            <span className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/35 to-black/10" />
          </span>
        ) : null}
        {!locked ? (
          <span
            data-trim="start"
            role="button"
            tabIndex={0}
            aria-label="Trim clip start"
            className="absolute inset-y-0 -left-1 z-10 flex w-3 cursor-ew-resize touch-none justify-start outline-none focus-visible:ring-2 focus-visible:ring-white"
            onKeyDown={nudgeKey("start")}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
              const origStart = startSec;
              const origEnd = endSec;
              const origIn = inSec;
              startTimelineDrag(event, pxPerSec, (delta) => {
                const next = trimStartBy(origStart, origEnd, origIn, delta);
                onTrimStart(next.startSec, next.inSec);
              });
            }}
          >
            <span className="pointer-events-none ml-1 h-full w-1.5 rounded-l-md bg-white/50" />
          </span>
        ) : null}
        <span
          className={`relative min-w-0 flex-1 truncate px-2 text-left text-[10px] leading-8 ${frames ? "text-white" : ""}`}
        >
          {label}
        </span>
        {!locked ? (
          <span
            data-trim="end"
            role="button"
            tabIndex={0}
            aria-label="Trim clip end"
            className="absolute inset-y-0 -right-1 z-10 flex w-3 cursor-ew-resize touch-none justify-end outline-none focus-visible:ring-2 focus-visible:ring-white"
            onKeyDown={nudgeKey("end")}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
              const origStart = startSec;
              const origEnd = endSec;
              const cap = Math.min(maxEnd, origStart + maxSpan);
              startTimelineDrag(event, pxPerSec, (delta) => {
                onTrimEnd(Math.max(origStart + 0.2, Math.min(cap, origEnd + delta)));
              });
            }}
          >
            <span className="pointer-events-none mr-1 h-full w-1.5 rounded-r-md bg-white/50" />
          </span>
        ) : null}
      </div>
    </div>
  );
}

function LayerPanelRow({
  id,
  selected,
  locked,
  hidden,
  canMute = false,
  muted = false,
  icon,
  label,
  dragOver,
  onSelect,
  onReorderStart,
  onReorderHover,
  onReorderCommit,
  onToggleLock,
  onToggleHidden,
  onToggleMute,
  onRepick,
  onDelete,
  onRename,
}: {
  id: string;
  selected: boolean;
  locked: boolean;
  hidden: boolean;
  canMute?: boolean;
  muted?: boolean;
  icon: ReactNode;
  label: string;
  dragOver: boolean;
  onSelect: () => void;
  onReorderStart: () => void;
  onReorderHover: (targetId: string | null) => void;
  onReorderCommit: (targetId: string | null) => void;
  onToggleLock: () => void;
  onToggleHidden: () => void;
  onToggleMute?: () => void;
  /** Set when the layer's device file is missing from this browser. */
  onRepick?: () => void;
  onDelete: () => void;
  onRename?: (nextName: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState(label);
  const committedRef = useRef(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (!editing) setEditDraft(label);
  }, [editing, label]);

  const commitEdit = (raw: string) => {
    if (committedRef.current || cancelledRef.current) return;
    committedRef.current = true;
    setEditing(false);
    const trimmed = raw.trim();
    if (trimmed !== label) {
      onRename?.(trimmed);
    }
  };

  const cancelEdit = () => {
    cancelledRef.current = true;
    setEditing(false);
    setEditDraft(label);
  };

  return (
    <div
      data-layer-row
      data-layer-id={id}
      onPointerDown={(event) => {
        if (locked || editing || event.button !== 0 || (event.target as HTMLElement).closest("[data-nodrag]")) {
          return;
        }
        onReorderStart();
        startLayerReorderDrag(event, onReorderHover, onReorderCommit);
      }}
      onClick={onSelect}
      className={`flex h-8 items-center gap-1 rounded-sm px-2 text-[11px] select-none touch-none ${
        locked ? "cursor-default" : editing ? "cursor-text" : "cursor-grab active:cursor-grabbing"
      } ${dragOver ? "ring-1 ring-brand-primary bg-brand-primary/10" : ""} ${
        selected ? "bg-brand-primary/20 text-text-primary" : "text-text-secondary hover:bg-white/5"
      }`}
    >
      <span className={`shrink-0 opacity-70 ${hidden ? "opacity-30" : ""}`}>{icon}</span>
      {editing ? (
        <input
          autoFocus
          value={editDraft}
          maxLength={LAYER_NAME_MAX}
          data-nodrag
          onChange={(event) => setEditDraft(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              commitEdit(editDraft);
            } else if (event.key === "Escape") {
              event.preventDefault();
              cancelEdit();
            }
          }}
          onBlur={() => {
            commitEdit(editDraft);
          }}
          className="min-w-0 flex-1 rounded bg-white/10 px-1 py-0.5 text-[11px] text-text-primary outline-none ring-1 ring-brand-primary"
        />
      ) : (
        <span
          onDoubleClick={(event) => {
            if (locked || !onRename) return;
            event.stopPropagation();
            event.preventDefault();
            committedRef.current = false;
            cancelledRef.current = false;
            setEditDraft(label);
            setEditing(true);
          }}
          className={`min-w-0 flex-1 truncate ${hidden ? "opacity-50" : ""}`}
          title="Double-click to rename"
        >
          {label}
        </span>
      )}
      <span className="flex shrink-0 items-center gap-0.5" data-nodrag>
        {onRepick ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onRepick();
            }}
            className="rounded px-1 py-0.5 text-[10px] font-medium text-warning hover:bg-warning/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-warning"
            aria-label="Media missing, re-pick the file"
            title="Media missing, re-pick the file"
          >
            Re-pick
          </button>
        ) : null}
        {canMute && onToggleMute ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggleMute();
            }}
            className={`rounded p-0.5 hover:bg-white/10 ${muted ? "text-warning opacity-90" : "text-text-secondary hover:text-text-primary"}`}
            aria-label={muted ? "Unmute audio" : "Mute audio"}
            title={muted ? "Unmute audio" : "Mute audio"}
          >
            {muted ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          </button>
        ) : null}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleHidden();
          }}
          className="rounded p-0.5 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary"
          aria-label={hidden ? "Show layer" : "Hide layer"}
          title={hidden ? "Show layer" : "Hide layer"}
        >
          {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onToggleLock();
          }}
          className="rounded p-0.5 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary"
          aria-label={locked ? "Unlock layer" : "Lock layer"}
          title={locked ? "Unlock layer" : "Lock layer"}
        >
          {locked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
        </button>
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          className="rounded p-0.5 text-error hover:bg-error/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-error"
          aria-label="Delete layer"
          title="Delete layer"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </span>
    </div>
  );
}

function textOverlay(startSec: number, endSec: number, z: number): EditorOverlay {
  return {
    id: newId("ov"),
    kind: "text",
    startSec: snapTenth(startSec),
    endSec: snapTenth(endSec),
    x: 0.08,
    y: 0.78,
    w: 0.84,
    h: 0.14,
    z,
    text: "Text",
    fontSize: 48,
    color: "#FFFFFF",
    creationId: null,
    storagePath: null,
    locked: false,
    hidden: false,
  };
}

function mediaOverlay(
  kind: "image" | "video",
  item: { id?: string; storagePath?: string | null; localMediaId?: string | null },
  startSec: number,
  endSec: number,
  z: number,
  canvas: { w: number; h: number }
): EditorOverlay {
  // Square default sized off the shorter canvas edge so a fresh overlay looks
  // the same regardless of which aspect ratio was active when it was added,
  // instead of the old w/h fractions whose on-screen shape depended on it.
  const side = 0.3 * Math.min(canvas.w, canvas.h);
  const w = side / canvas.w;
  const h = side / canvas.h;
  return {
    id: newId("ov"),
    kind,
    startSec: snapTenth(startSec),
    endSec: snapTenth(endSec),
    x: 1 - w - 0.06,
    y: 0.06,
    w,
    h,
    z,
    text: null,
    fontSize: null,
    color: null,
    creationId: item.id ?? null,
    storagePath: item.storagePath?.trim() || null,
    localMediaId: item.localMediaId ?? null,
    sourceDurationSec: kind === "video" ? null : undefined,
    locked: false,
    hidden: false,
    muted: kind === "video" ? false : undefined,
  };
}

function MissingMedia() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-white/5 p-2 text-center text-[11px] text-warning">
      <AlertCircle className="h-4 w-4" />
      Media missing, re-pick the file
    </div>
  );
}

/**
 * `localUrl` — object URL of a device file kept in this browser; skips signing.
 * `missing` — a device file this browser no longer has.
 */
function SignedVideo({
  storagePath,
  localUrl,
  missing = false,
  currentTime,
  playing,
  muted = false,
  onNaturalSize,
  videoRef,
}: {
  storagePath: string | null;
  localUrl?: string | null;
  missing?: boolean;
  currentTime: number;
  playing: boolean;
  muted?: boolean;
  onNaturalSize?: (naturalWidth: number, naturalHeight: number) => void;
  videoRef?: (node: HTMLVideoElement | null) => void;
}) {
  const url = useSignedMediaUrl(localUrl ? null : storagePath, localUrl);
  const ref = useRef<HTMLVideoElement | null>(null) as React.MutableRefObject<
    HTMLVideoElement | null
  >;

  useEffect(() => {
    const el = ref.current;
    if (!el || !url) return;
    const gap = Math.abs(el.currentTime - currentTime);
    if (gap > 0.18) el.currentTime = Math.max(0, currentTime);
    el.muted = muted;
    if (playing) void el.play().catch(() => undefined);
    else el.pause();
  }, [currentTime, playing, url, muted]);

  if (missing) return <MissingMedia />;
  if (!url) {
    return <div className="h-full w-full animate-pulse bg-white/5" />;
  }
  return (
    <video
      ref={(node) => {
        ref.current = node;
        videoRef?.(node);
      }}
      src={url}
      muted={muted}
      playsInline
      className="h-full w-full object-contain"
      onLoadedMetadata={(event) => {
        const video = event.currentTarget;
        onNaturalSize?.(video.videoWidth, video.videoHeight);
      }}
    />
  );
}

function SignedImage({
  storagePath,
  localUrl,
  missing = false,
  onNaturalSize,
}: {
  storagePath: string | null;
  localUrl?: string | null;
  missing?: boolean;
  onNaturalSize?: (naturalWidth: number, naturalHeight: number) => void;
}) {
  const url = useSignedMediaUrl(localUrl ? null : storagePath, localUrl);
  if (missing) return <MissingMedia />;
  if (!url) return <div className="h-full w-full animate-pulse bg-white/10" />;
  if (localUrl) {
    // A blob: URL never leaves the browser, so the Next image optimizer can't fetch it.
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={localUrl}
        alt=""
        className="absolute inset-0 h-full w-full object-contain"
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
        onLoad={(event) => {
          const img = event.currentTarget;
          onNaturalSize?.(img.naturalWidth, img.naturalHeight);
        }}
      />
    );
  }
  return (
    <Image
      src={url}
      alt=""
      fill
      sizes="240px"
      className="object-contain"
      draggable={false}
      onDragStart={(event) => event.preventDefault()}
      onLoad={(event) => {
        const img = event.currentTarget;
        onNaturalSize?.(img.naturalWidth, img.naturalHeight);
      }}
    />
  );
}

type EditorToastState = {
  id: string;
  type: "success" | "error" | "info";
  message: string;
};

function EditorToast({ toast, onDismiss }: { toast: EditorToastState; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 5000);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  const isSuccess = toast.type === "success";

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 z-50 flex max-w-md -translate-x-1/2 items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl backdrop-blur-md transition-all duration-300 ${
        isSuccess
          ? "border-success/30 bg-N100/95 text-text-primary"
          : toast.type === "info"
            ? "border-white/15 bg-N100/95 text-text-primary"
            : "border-error/30 bg-N100/95 text-text-primary"
      }`}
    >
      {isSuccess ? (
        <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
      ) : toast.type === "info" ? (
        <Info className="h-4 w-4 shrink-0 text-text-secondary" />
      ) : (
        <AlertCircle className="h-4 w-4 shrink-0 text-error" />
      )}
      <span className="text-xs font-medium leading-relaxed">{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Tutup notifikasi"
        className="ml-auto shrink-0 cursor-pointer p-0.5 text-text-secondary hover:text-text-primary transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

type EditorExportPollData = { error?: string; code?: string; ok?: boolean; creation?: { id?: string } };

const EXPORT_POLL_MS = 3000;

/** Polls the generation status for an accepted (202) export until it succeeds or fails. */
async function pollEditorExport(
  idempotencyKey: string
): Promise<{ ok: boolean; data: EditorExportPollData }> {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, EXPORT_POLL_MS));
    try {
      const res = await fetch("/api/generations/status", { headers: { "Idempotency-Key": idempotencyKey } });
      // A missing request or lost session can never recover; anything else is transient, so the
      // attempt stays locked and polling continues until an explicit terminal status.
      if (res.status === 401 || res.status === 404) {
        return { ok: false, data: { error: "Couldn't confirm the export. Check My Library in a moment." } };
      }
      if (!res.ok) continue;
      const body = (await res.json()) as {
        status?: string;
        result?: EditorExportPollData | null;
        error?: { message?: string; code?: string } | null;
      };
      if (body.status === "succeeded") return { ok: true, data: body.result ?? {} };
      if (body.status === "failed") {
        return { ok: false, data: { error: body.error?.message, code: body.error?.code } };
      }
    } catch {
      /* transient network error: keep polling */
    }
  }
}

export default function EditorWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status, user } = useCurrentUser();
  const userId = user?.id ?? null;
  const { openSignInModal } = useAuthModal();
  const { openLibrary } = useEditorLibrary();
  const { openPreview } = useStudioGenerationPreview();
  const { begin } = useIdempotentSubmit("editor:export");

  const [title, setTitle] = useState(DEFAULT_EDITOR_TITLE);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [doc, setDoc] = useState<EditorDocument>(emptyEditorDocument);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rawPlayhead, setPlayhead] = useState(0);
  // Duration is derived from layers, so it can shrink under the playhead; clamp on read.
  const playhead = Math.min(rawPlayhead, sequenceDurationSec(doc));
  const [timeInputDraft, setTimeInputDraft] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [exportProgress, setExportProgress] = useState<ExportProgressState | null>(null);
  const [exportProgressOpen, setExportProgressOpen] = useState(false);
  // Idempotency-Key being polled for display / resume; null stops polling.
  const [pollKey, setPollKey] = useState<string | null>(null);
  // True when this tab did not start the render fetch (page reload): polling decides the outcome.
  const resumedExportRef = useRef(false);
  const lastExportRef = useRef<{ name: string; settings: EditorExportSettings } | null>(null);
  // Session-only device media: localMediaId → object URL (null = this browser no longer has it).
  // Never written to the document.
  const [localUrls, setLocalUrls] = useState<Record<string, string | null>>({});
  const [toast, setToast] = useState<EditorToastState | null>(null);

  const showToast = useCallback((t: { type: EditorToastState["type"]; message: string }) => {
    setToast({ id: crypto.randomUUID(), ...t });
  }, []);

  const dismissToast = useCallback(() => {
    setToast(null);
  }, []);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const rulerScrollRef = useRef<HTMLDivElement>(null);
  const tracksScrollRef = useRef<HTMLDivElement>(null);
  const [pxPerSec, setPxPerSec] = useState(DEFAULT_PX_PER_SEC);
  const pxPerSecRef = useRef(DEFAULT_PX_PER_SEC);
  /** scrollLeft to apply once the new width is laid out (anchored zoom). */
  const pendingScrollRef = useRef<number | null>(null);
  const preFitScaleRef = useRef<number | null>(null);
  /** Set by loadProject; the first non-empty measured layout after it fits the timeline once. */
  const fitOnOpenRef = useRef(false);
  const setScaleAndRewind = useCallback((next: number) => {
    const scroller = tracksScrollRef.current;
    preFitScaleRef.current = null;
    if (next !== pxPerSecRef.current) {
      pendingScrollRef.current = 0;
      pxPerSecRef.current = next;
      setPxPerSec(next);
    } else if (scroller) {
      scroller.scrollLeft = 0;
      if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = 0;
    }
  }, []);
  /** Latest zoom actions for the long-lived keydown listener. */
  const applyScaleRef = useRef<(next: number, anchorX: number) => void>(() => {});
  const measureViewportRef = useRef(() => {});
  const zoomActionsRef = useRef<{ zoomBy: (dir: 1 | -1) => void; fit: () => void }>({ zoomBy: () => {}, fit: () => {} });
  const [rulerView, setRulerView] = useState({ width: 0, bucket: 0 });
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const underlyingVideosRef = useRef<Map<string, HTMLVideoElement>>(new Map());
  const fittedOverlaysRef = useRef<Set<string>>(new Set());
  const [playing, setPlaying] = useState(false);
  // Session-only: not part of EditorDocument, autosave, undo history, or export.
  const [loop, setLoop] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openList, setOpenList] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [panelWidth, setPanelWidth] = useState(LAYER_PANEL_DEFAULT_WIDTH);
  const [tracksHeight, setTracksHeight] = useState(TIMELINE_TRACKS_DEFAULT_HEIGHT);
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const [tool, setTool] = useState<EditorTool>("select");
  const [past, setPast] = useState<EditorDocument[]>([]);
  const [future, setFuture] = useState<EditorDocument[]>([]);

  const titleRef = useRef(title);
  const docRef = useRef(doc);
  const pastRef = useRef(past);
  const futureRef = useRef(future);
  const selectedIdRef = useRef(selectedId);
  const lastPatchRef = useRef<{ key: string; at: number } | null>(null);
  const projectIdRef = useRef(projectId);
  const lastSavedRef = useRef(fingerprintOf(DEFAULT_EDITOR_TITLE, emptyEditorDocument()));
  const persistedTitleRef = useRef(DEFAULT_EDITOR_TITLE);
  const playStartPerf = useRef(0);
  const playStartHead = useRef(0);
  const creationLinkRef = useRef(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadKindRef = useRef<"sequence" | "image" | "video">("sequence");
  const repickLayerIdRef = useRef<string | null>(null);
  // Device files for this session (and the export upload), by localMediaId.
  const localFilesRef = useRef<Map<string, File>>(new Map());
  const localUrlsRef = useRef(localUrls);
  localUrlsRef.current = localUrls;
  // The export's upload phase; null once the render request is sent.
  const exportUploadRef = useRef<{ controller: AbortController; paths: string[] } | null>(null);
  const dragLayerIdRef = useRef<string | null>(null);
  const lastActiveClipRef = useRef<EditorClip | null>(null);
  const lastActiveLocalSecRef = useRef(0);
  const playheadRef = useRef(playhead);
  const loopRef = useRef(loop);
  titleRef.current = title;
  docRef.current = doc;
  projectIdRef.current = projectId;
  pastRef.current = past;
  futureRef.current = future;
  selectedIdRef.current = selectedId;
  playheadRef.current = playhead;
  loopRef.current = loop;

  const currentVisibleClip = () =>
    clipAtPlayhead(
      { ...docRef.current, sequence: docRef.current.sequence.filter((c) => !c.hidden) },
      playheadRef.current
    );

  // With loop on, playing from the end restarts at the first frame.
  const rewindForLoop = () => {
    if (!loopRef.current || playheadRef.current < sequenceDurationSec(docRef.current)) return;
    playheadRef.current = 0;
    setPlayhead(0);
  };

  const duration = sequenceDurationSec(doc);
  const localUrlFor = (layer: EditorClip | EditorOverlay): string | null =>
    layer.localMediaId ? localUrls[layer.localMediaId] ?? null : null;
  const isMissingMedia = (layer: EditorClip | EditorOverlay): boolean =>
    isLocalOnlyLayer(layer) && localUrls[layer.localMediaId!] === null;
  const hasMissingMedia = [...doc.sequence, ...doc.overlays].some(isMissingMedia);
  const exportCheck =
    validateEditorExport(doc, { allowLocal: true }) ??
    (hasMissingMedia ? { code: "LOCAL_MEDIA_MISSING", message: "Re-pick missing media to export." } : null);
  const fingerprint = useMemo(() => fingerprintOf(title, doc), [title, doc]);
  const dirty = fingerprint !== lastSavedRef.current;
  const sequence = sortedSequence(doc);
  const overlays = sortedOverlays(doc);
  const covering = clipsAtPlayhead(
    { ...doc, sequence: doc.sequence.filter((c) => !c.hidden) },
    playhead
  );
  const active = covering[covering.length - 1] ?? null;
  // Lower covering clips stay audible (matching the export mix); only the top one is pictured.
  const underlying = covering.slice(0, -1).filter((c) => !c.clip.muted);
  if (active) {
    lastActiveClipRef.current = active.clip;
    lastActiveLocalSecRef.current = active.localSec;
  }
  const canvas = EDITOR_CANVAS[doc.aspect];
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setStageSize({ w: rect.width, h: rect.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const previewSize = containSize(stageSize, canvas, EDITOR_PREVIEW_MIN_PX);
  const viewport = useEditorViewport(
    stageRef,
    { width: previewSize.width, height: previewSize.height },
    stageSize,
    tool === "hand"
  );
  const selectedClip = doc.sequence.find((c) => c.id === selectedId) ?? null;
  const selectedOverlay = doc.overlays.find((o) => o.id === selectedId) ?? null;
  const navClip = selectedClip ?? active?.clip ?? null;

  const canSplitSelected = selectedClip ? canSplitClip(selectedClip, playhead) : false;
  const canTrimStart = selectedClip ? canTrimClipStart(selectedClip, playhead) : false;
  const canTrimEnd = selectedClip ? canTrimClipEnd(selectedClip, playhead) : false;

  const stepPlayhead = (deltaSec: number) => {
    setPlaying(false);
    setPlayhead((head) => snapTenth(Math.max(0, Math.min(duration, head + deltaSec))));
  };
  const jumpToClipStart = () => {
    setPlaying(false);
    setPlayhead(snapTenth(Math.max(0, Math.min(duration, navClip ? navClip.startSec : 0))));
  };
  const jumpToClipEnd = () => {
    setPlaying(false);
    setPlayhead(snapTenth(Math.max(0, Math.min(duration, navClip ? navClip.endSec : duration))));
  };
  useEffect(() => {
    if (!addMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!addMenuRef.current?.contains(event.target as Node)) setAddMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAddMenuOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [addMenuOpen]);
  const commitTimeInput = (raw: string) => {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      setPlaying(false);
      setPlayhead(snapTenth(Math.max(0, Math.min(duration, parsed))));
    }
    setTimeInputDraft(null);
  };

  // Stack order ascending (order/z 0 = back). Panel/lane rows show frontmost on top.
  const clipRows = sequence
    .map((clip, i) => ({ clip, label: resolveLayerLabel(clip, i) }))
    .reverse();
  let imageOverlayCount = 0;
  let videoOverlayCount = 0;
  const overlayRows = overlays
    .map((overlay) => {
      let typeIndex: number | undefined;
      if (overlay.kind === "image") {
        typeIndex = imageOverlayCount;
        imageOverlayCount += 1;
      } else if (overlay.kind === "video") {
        typeIndex = videoOverlayCount;
        videoOverlayCount += 1;
      }
      return { overlay, label: resolveLayerLabel(overlay, typeIndex) };
    })
    .reverse();

  // Panel/lane rows display frontmost-on-top, i.e. the reverse of ascending order/z.
  // Reorder against that same displayed order so a drop lands where it visually looks like it did.
  function displayIndexById<T extends { id: string }>(
    list: T[],
    sourceId: string,
    targetId: string
  ): Map<string, number> | null {
    const reordered = reorderById([...list].reverse(), sourceId, targetId);
    if (!reordered) return null;
    const n = reordered.length;
    return new Map(reordered.map((item, i) => [item.id, n - 1 - i]));
  }

  const reorderClips = (sourceId: string, targetId: string) => {
    const orderById = displayIndexById(sequence, sourceId, targetId);
    if (!orderById) return;
    patchDoc((current) => ({
      ...current,
      sequence: current.sequence.map((c) => ({ ...c, order: orderById.get(c.id) ?? c.order })),
    }));
  };

  const reorderOverlays = (sourceId: string, targetId: string) => {
    const zById = displayIndexById(overlays, sourceId, targetId);
    if (!zById) return;
    patchDoc((current) => ({
      ...current,
      overlays: current.overlays.map((o) => ({ ...o, z: zById.get(o.id) ?? o.z })),
    }));
  };

  const applyUrl = useCallback(
    (id: string | null) => {
      const url = id ? `/tools/editor?projectId=${encodeURIComponent(id)}` : "/tools/editor";
      router.replace(url, { scroll: false });
    },
    [router]
  );

  // Continuous drags (overlay move/resize, timeline trim) call patchDoc on every
  // pointermove; coalesceKey collapses same-key patches within this window into
  // one undo step instead of one per pixel.
  // ponytail: time-window coalescing, not true gesture-scoped (pointerdown/up) —
  // a >650ms pause mid-drag splits into two undo steps. Upgrade to explicit
  // begin/end-gesture calls if that granularity ever bothers users.
  const patchDoc = useCallback(
    (updater: (current: EditorDocument) => EditorDocument, opts?: { coalesceKey?: string; keepPlaying?: boolean }) => {
      const current = docRef.current;
      const next = updater(current);
      const key = opts?.coalesceKey ?? null;
      const now = performance.now();
      const last = lastPatchRef.current;
      const coalesced = key != null && last?.key === key && now - last.at < HISTORY_COALESCE_MS;
      if (!coalesced) {
        setPast((p) => [...p.slice(-HISTORY_LIMIT + 1), current]);
        setFuture([]);
      }
      lastPatchRef.current = key != null ? { key, at: now } : null;
      docRef.current = next;
      setDoc(next);
      if (!opts?.keepPlaying) setPlaying(false);
    },
    []
  );

  const handleSplitSelected = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    const clip = docRef.current.sequence.find((c) => c.id === id);
    if (!clip || !canSplitClip(clip, playheadRef.current)) return;
    const result = splitEditorClip(docRef.current, id, playheadRef.current);
    if (!result) return;
    patchDoc(() => result.doc);
    setSelectedId(result.rightClipId);
  }, [patchDoc]);

  const handleTrimStartToPlayhead = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    const clip = docRef.current.sequence.find((c) => c.id === id);
    if (!clip || !canTrimClipStart(clip, playheadRef.current)) return;
    const updated = trimClipStartToPlayhead(docRef.current, id, playheadRef.current);
    if (!updated) return;
    patchDoc(() => updated);
  }, [patchDoc]);

  const handleTrimEndToPlayhead = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    const clip = docRef.current.sequence.find((c) => c.id === id);
    if (!clip || !canTrimClipEnd(clip, playheadRef.current)) return;
    const updated = trimClipEndToPlayhead(docRef.current, id, playheadRef.current);
    if (!updated) return;
    patchDoc(() => updated);
  }, [patchDoc]);

  const undo = useCallback(() => {
    const p = pastRef.current;
    if (p.length === 0) return;
    const prev = p[p.length - 1];
    setFuture((f) => [docRef.current, ...f].slice(0, HISTORY_LIMIT));
    setPast(p.slice(0, -1));
    docRef.current = prev;
    setDoc(prev);
    setSelectedId(null);
    lastPatchRef.current = null;
  }, []);

  const redo = useCallback(() => {
    const f = futureRef.current;
    if (f.length === 0) return;
    const next = f[0];
    setPast((p) => [...p, docRef.current].slice(-HISTORY_LIMIT));
    setFuture(f.slice(1));
    docRef.current = next;
    setDoc(next);
    setSelectedId(null);
    lastPatchRef.current = null;
  }, []);

  const removeLayer = useCallback(
    (kind: "clip" | "overlay", id: string) => {
      patchDoc((current) => ({
        ...current,
        sequence:
          kind === "clip"
            ? current.sequence.filter((c) => c.id !== id).map((c, order) => ({ ...c, order }))
            : current.sequence,
        overlays: kind === "overlay" ? current.overlays.filter((o) => o.id !== id) : current.overlays,
      }));
      setSelectedId((current) => (current === id ? null : current));
    },
    [patchDoc]
  );

  const deleteSelected = useCallback(() => {
    const id = selectedIdRef.current;
    if (!id) return;
    const isClip = docRef.current.sequence.some((c) => c.id === id);
    removeLayer(isClip ? "clip" : "overlay", id);
  }, [removeLayer]);

  const loadProject = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/editor/projects/${id}`);
      const data = (await res.json().catch(() => ({}))) as {
        project?: { id: string; title: string; document: EditorDocument };
        error?: string;
      };
      if (res.status === 401) {
        openSignInModal();
        return;
      }
      if (!res.ok || !data.project) {
        throw new Error(data.error || "Couldn't open that edit.");
      }
      const parsed = parseEditorDocument(data.project.document) ?? emptyEditorDocument();
      setProjectId(data.project.id);
      setTitle(data.project.title);
      persistedTitleRef.current = data.project.title;
      setDoc(parsed);
      fitOnOpenRef.current = true;
      setSelectedId(null);
      setPlayhead(0);
      setPlaying(false);
      setPast([]);
      setFuture([]);
      lastSavedRef.current = fingerprintOf(data.project.title, parsed);
      applyUrl(data.project.id);
    },
    [applyUrl, openSignInModal]
  );

  const resetProject = useCallback(() => {
    const empty = emptyEditorDocument();
    setProjectId(null);
    setTitle(DEFAULT_EDITOR_TITLE);
    persistedTitleRef.current = DEFAULT_EDITOR_TITLE;
    setDoc(empty);
    fitOnOpenRef.current = false;
    setScaleAndRewind(DEFAULT_PX_PER_SEC);
    setSelectedId(null);
    setPlayhead(0);
    setPlaying(false);
    setPast([]);
    setFuture([]);
    lastSavedRef.current = fingerprintOf(DEFAULT_EDITOR_TITLE, empty);
    applyUrl(null);
  }, [applyUrl, setScaleAndRewind]);

  const handleSave = useCallback(async () => {
    if (status !== "authenticated") {
      openSignInModal();
      return;
    }
    const nextTitle = titleRef.current;
    const nextDoc = docRef.current;
    const nextFingerprint = fingerprintOf(nextTitle, nextDoc);
    if (nextFingerprint === lastSavedRef.current) return;
    setSaving(true);
    try {
      const id = projectIdRef.current;
      const res = await fetch(id ? `/api/editor/projects/${id}` : "/api/editor/projects", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle, document: nextDoc }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        project?: { id: string; title: string };
        error?: string;
      };
      if (res.status === 401) {
        openSignInModal();
        return;
      }
      if (!res.ok || !data.project) {
        throw new Error(data.error || "Couldn't save this edit.");
      }
      setProjectId(data.project.id);
      setTitle(data.project.title);
      persistedTitleRef.current = data.project.title;
      lastSavedRef.current = fingerprintOf(data.project.title, docRef.current);
      applyUrl(data.project.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Couldn't save this edit.");
    } finally {
      setSaving(false);
    }
  }, [applyUrl, openSignInModal, status]);

  useEffect(() => {
    if (!dirty || status !== "authenticated") return;
    const timer = window.setTimeout(() => {
      void handleSave();
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [dirty, fingerprint, handleSave, status]);

  const commitTitle = useCallback(
    async (raw: string) => {
      const nextTitle = normalizeEditorTitle(raw);
      setTitle(nextTitle);
      if (nextTitle === persistedTitleRef.current) return;
      const id = projectIdRef.current;
      if (!id) return;
      if (status !== "authenticated") {
        openSignInModal();
        return;
      }
      try {
        const res = await fetch(`/api/editor/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: nextTitle }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          project?: { id: string; title: string };
          error?: string;
        };
        if (res.status === 401) {
          openSignInModal();
          setTitle(persistedTitleRef.current);
          return;
        }
        if (!res.ok || !data.project) throw new Error(data.error || "Couldn't rename this edit.");
        setTitle(data.project.title);
        persistedTitleRef.current = data.project.title;
      } catch (err) {
        window.alert(err instanceof Error ? err.message : "Couldn't rename this edit.");
        setTitle(persistedTitleRef.current);
      }
    },
    [openSignInModal, status]
  );

  useEffect(() => {
    const id = searchParams.get("projectId")?.trim();
    if (!id || id === projectIdRef.current) return;
    void loadProject(id).catch((err) => console.error(err));
  }, [loadProject, searchParams]);

  useEffect(() => {
    if (creationLinkRef.current) return;
    if (searchParams.get("projectId")?.trim()) return;
    const creationId = searchParams.get("creationId")?.trim();
    if (!creationId) return;
    creationLinkRef.current = true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/creations/history?ids=${encodeURIComponent(creationId)}&limit=1`
        );
        const data = (await res.json()) as { items?: CreationHistoryItem[] };
        const item = data.items?.[0];
        if (!res.ok || !item || !canDropOnEditor(item) || item.mediaType !== "video") return;
        const storagePath = item.storagePath?.trim() || null;
        setDoc((current) => ({
          ...current,
          sequence: [...current.sequence, clipFromLibrary(item, current.sequence.length, 0)],
        }));
        if (storagePath) {
          void (async () => {
            try {
              const signed = await fetchSignedUrl({ path: storagePath });
              if (!signed.url) return;
              const sourceDurationSec = await probeVideoDurationSec(signed.url);
              if (sourceDurationSec == null) return;
              setDoc((current) => ({
                ...current,
                sequence: current.sequence.map((row) =>
                  row.creationId === item.id
                    ? // Deep-linked clips start as a 0–3s placeholder; keep any edit made since.
                      withProbedClipSource(row, sourceDurationSec, row.startSec === 0 && row.endSec === 3)
                    : row
                ),
              }));
            } catch {
              // Unknown source length stays uncapped except by the overall cap.
            }
          })();
        }
      } catch {
        // Deep-link miss stays an empty timeline.
      }
    })();
  }, [searchParams]);

  // Gives every device-media layer an object URL (new file, reopened project, undo)
  // and revokes URLs no layer uses any more. A file this browser no longer has → null.
  const resolvingLocalRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const usedIds = (current: EditorDocument) =>
      new Set([...current.sequence, ...current.overlays].flatMap((layer) => layer.localMediaId ?? []));
    const ids = usedIds(doc);
    const urls = localUrlsRef.current;
    const unused = Object.keys(urls).filter((id) => !ids.has(id));
    if (unused.length > 0) {
      for (const id of unused) if (urls[id]) URL.revokeObjectURL(urls[id]!);
      setLocalUrls((current) => {
        const next = { ...current };
        for (const id of unused) delete next[id];
        return next;
      });
    }
    for (const id of ids) {
      if (id in urls || resolvingLocalRef.current.has(id)) continue;
      const inMemory = localFilesRef.current.get(id);
      // Wait for the signed-in user before reading this browser's copy, so a slow
      // auth load is not mistaken for missing media.
      if (!inMemory && !userId) continue;
      resolvingLocalRef.current.add(id);
      void (async () => {
        const file = inMemory ?? (await getLocalMedia(localMediaKey(userId!, id)));
        resolvingLocalRef.current.delete(id);
        if (file) localFilesRef.current.set(id, file);
        if (!usedIds(docRef.current).has(id)) return;
        const url = file ? URL.createObjectURL(file) : null;
        setLocalUrls((current) => ({ ...current, [id]: url }));
      })();
    }
  }, [doc, userId]);

  useEffect(
    () => () => {
      for (const url of Object.values(localUrlsRef.current)) if (url) URL.revokeObjectURL(url);
      const upload = exportUploadRef.current;
      if (upload) {
        upload.controller.abort();
        deleteRefUploads(upload.paths.splice(0));
      }
    },
    []
  );

  useEffect(() => {
    if (!playing) return;
    playStartPerf.current = performance.now();
    playStartHead.current = playhead;
    let raf = 0;
    const tick = () => {
      const elapsed = (performance.now() - playStartPerf.current) / 1000;
      const next = Math.min(duration, playStartHead.current + elapsed);
      setPlayhead(next);
      if (next >= duration) {
        if (loopRef.current && duration > 0) {
          playStartPerf.current = performance.now();
          playStartHead.current = 0;
          setPlayhead(0);
          raf = requestAnimationFrame(tick);
          return;
        }
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // Intentionally omit playhead — we snapshot it when play starts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, duration]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (fingerprintOf(titleRef.current, docRef.current) === lastSavedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const editable = target?.closest("input, textarea, select, [contenteditable='true']");
      const meta = event.metaKey || event.ctrlKey;
      const save = meta && event.key.toLowerCase() === "s" && !event.shiftKey;
      if (save) {
        event.preventDefault();
        void handleSave();
        return;
      }
      if (
        meta &&
        !editable &&
        !event.repeat &&
        !event.shiftKey &&
        !event.altKey &&
        event.key.toLowerCase() === "b"
      ) {
        if (typeof document !== "undefined" && document.querySelector("[role='dialog'], [aria-modal='true']")) {
          return;
        }
        event.preventDefault();
        handleSplitSelected();
        return;
      }
      if (meta && !editable && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
        event.preventDefault();
        if (event.key.toLowerCase() === "y" || event.shiftKey) redo();
        else undo();
        return;
      }
      if (!editable && !meta && !event.altKey) {
        if (event.key === "+" || event.key === "=") {
          event.preventDefault();
          zoomActionsRef.current.zoomBy(1);
          return;
        }
        if (event.key === "-" || event.key === "_") {
          event.preventDefault();
          zoomActionsRef.current.zoomBy(-1);
          return;
        }
        if (event.shiftKey && event.key.toLowerCase() === "z" && !event.repeat) {
          event.preventDefault();
          zoomActionsRef.current.fit();
          return;
        }
      }
      if (!editable && (event.key === "Delete" || event.key === "Backspace")) {
        event.preventDefault();
        deleteSelected();
        return;
      }
      if (event.code === "Space" && !event.repeat) {
        if (editable) return;
        event.preventDefault();
        // No-op while looping playback runs: the clock wraps before the playhead rests at the end.
        rewindForLoop();
        setPlaying((current) => {
          const next = current ? false : sequenceDurationSec(docRef.current) > 0;
          const el = previewVideoRef.current;
          const activeClip = next ? currentVisibleClip() : null;
          if (!next) el?.pause();
          // Only start the element directly when a clip covers the playhead; at the end
          // or in a gap SignedVideo's playing prop stays false and would never pause it.
          else if (el && activeClip) {
            el.muted = Boolean(activeClip.clip.muted);
            void el.play().catch(() => undefined);
          }
          // SignedVideo's effect also plays these; starting them here keeps the user gesture.
          if (next) {
            for (const v of underlyingVideosRef.current.values()) void v.play().catch(() => undefined);
          }
          return next;
        });
      }
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("keydown", onKey);
    };
  }, [handleSave, undo, redo, deleteSelected, handleSplitSelected]);

  // Layer ids with a source-length probe in flight (add-time or re-measure), so one
  // layer is never probed twice at once.
  const probingRef = useRef<Set<string>>(new Set());
  // Works for clips and video overlays: the layer id is unique across both.
  // `fillSpan` says whether the layer is still at its placeholder span (it then grows to its source).
  // `localUrl` probes a device file directly instead of signing a storage path.
  const probeLayerSource = useCallback(async (
    layerId: string,
    storagePath: string | null,
    fillSpan: (layer: EditorClip | EditorOverlay) => boolean,
    apply: (updater: (current: EditorDocument) => EditorDocument) => void,
    localUrl?: string | null
  ) => {
    if ((!storagePath && !localUrl) || probingRef.current.has(layerId)) return;
    probingRef.current.add(layerId);
    try {
      const url = localUrl ?? (await fetchSignedUrl({ path: storagePath! })).url;
      if (!url) return;
      const sourceDurationSec = await probeVideoDurationSec(url);
      if (sourceDurationSec == null) return;
      apply((current) => withProbedLayerSource(current, layerId, sourceDurationSec, fillSpan));
    } catch {
      // Unknown source length stays uncapped until the next re-measure pass.
    } finally {
      probingRef.current.delete(layerId);
    }
  }, []);

  // `placeholder` is the span the layer was created with.
  const attachSourceDuration = useCallback((
    layerId: string,
    storagePath: string | null,
    placeholder: { startSec: number; endSec: number },
    localUrl?: string
  ) =>
    probeLayerSource(
      layerId,
      storagePath,
      (layer) => layer.startSec === placeholder.startSec && layer.endSec === placeholder.endSec,
      patchDoc,
      localUrl
    ),
  [patchDoc, probeLayerSource]);

  // Measures every clip / video overlay saved without a source length (a probe that
  // hung in a background tab, or a project saved before the probe could finish), so
  // the source cap applies. Idempotent; runs on load, when device media resolves and
  // when the tab becomes visible. Applied without an undo step; autosave persists it.
  // ponytail: undo/redo snapshots taken before the measurement keep the null source
  // until the next pass; re-run on undo if that ever shows up.
  const measureMissingSources = useCallback(() => {
    const apply = (updater: (current: EditorDocument) => EditorDocument) => {
      const next = updater(docRef.current);
      if (next === docRef.current) return;
      docRef.current = next;
      setDoc(next);
    };
    const { sequence, overlays } = docRef.current;
    for (const layer of [...sequence, ...overlays.filter((o) => o.kind === "video")]) {
      if (layer.sourceDurationSec != null) continue;
      const localUrl = layer.localMediaId ? localUrlsRef.current[layer.localMediaId] : null;
      void probeLayerSource(layer.id, layer.storagePath, isPlaceholderSpan, apply, localUrl);
    }
  }, [probeLayerSource]);

  // projectId changes when a project loads; localUrls when its device media resolves.
  useEffect(() => {
    measureMissingSources();
  }, [projectId, localUrls, measureMissingSources]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") measureMissingSources();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [measureMissingSources]);

  const addClip = (item: CreationHistoryItem) => {
    if (item.mediaType !== "video" || !canDropOnEditor(item)) return;
    if (docRef.current.sequence.length >= EDITOR_MAX_SEQUENCE) return;
    const clip = clipFromLibrary(item, docRef.current.sequence.length, playhead);
    patchDoc((current) => ({
      ...current,
      sequence: [...current.sequence, clip],
    }));
    void attachSourceDuration(clip.id, clip.storagePath, clip);
  };

  const addOverlayFromItem = (kind: "image" | "video", item: CreationHistoryItem) => {
    if (!canDropOnEditor(item)) return;
    if (kind === "image" && item.mediaType !== "image") return;
    if (kind === "video" && item.mediaType !== "video") return;
    if (docRef.current.overlays.length >= EDITOR_MAX_OVERLAYS) return;
    const { start, end } = placeLayer(playhead, 2);
    const overlay = mediaOverlay(
      kind,
      item,
      start,
      end,
      docRef.current.overlays.length,
      EDITOR_CANVAS[docRef.current.aspect]
    );
    patchDoc((current) => ({ ...current, overlays: [...current.overlays, overlay] }));
    if (kind === "video") void attachSourceDuration(overlay.id, overlay.storagePath, overlay);
  };

  // Keeps a device file in this browser and returns its new localMediaId + object URL.
  const keepDeviceFile = (file: File): { localMediaId: string; url: string } => {
    const localMediaId = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    localFilesRef.current.set(localMediaId, file);
    localUrlsRef.current = { ...localUrlsRef.current, [localMediaId]: url };
    setLocalUrls((current) => ({ ...current, [localMediaId]: url }));
    void (async () => {
      const stored = userId ? await putLocalMedia(localMediaKey(userId, localMediaId), file) : false;
      if (!stored) {
        showToast({
          type: "info",
          message: "This browser couldn't keep a copy of the file. Re-pick it after reloading.",
        });
      }
    })();
    return { localMediaId, url };
  };

  // Device files stay in the browser; nothing uploads until Export.
  // Returns false when a layer limit stops further adds (so a multi-file drop can stop).
  const onUpload = (file: File, kind = uploadKindRef.current): boolean => {
    const repickId = repickLayerIdRef.current;
    repickLayerIdRef.current = null;
    const validation = validateEditorUploadFile(file, kind);
    if (!validation.ok) {
      showToast({ type: "error", message: validation.error });
      return true;
    }
    if (repickId) {
      void repickMedia(repickId, file);
      return true;
    }
    if (kind === "sequence") {
      if (docRef.current.sequence.length >= EDITOR_MAX_SEQUENCE) {
        showToast({
          type: "error",
          message: `Sequence limit reached (${EDITOR_MAX_SEQUENCE} clips).`,
        });
        return false;
      }
      const { localMediaId, url } = keepDeviceFile(file);
      const clip = clipFromDevice(localMediaId, docRef.current.sequence.length, playhead);
      patchDoc((current) => ({
        ...current,
        sequence: [...current.sequence, clip],
      }));
      setSelectedId(clip.id);
      void attachSourceDuration(clip.id, null, clip, url);
      showToast({ type: "success", message: "Media added" });
      return true;
    }
    if (docRef.current.overlays.length >= EDITOR_MAX_OVERLAYS) {
      showToast({
        type: "error",
        message: `Overlay limit reached (${EDITOR_MAX_OVERLAYS}).`,
      });
      return false;
    }
    const { localMediaId, url } = keepDeviceFile(file);
    const { start, end } = placeLayer(playhead, 2);
    const overlay = mediaOverlay(
      kind,
      { localMediaId },
      start,
      end,
      docRef.current.overlays.length,
      EDITOR_CANVAS[docRef.current.aspect]
    );
    patchDoc((current) => ({ ...current, overlays: [...current.overlays, overlay] }));
    setSelectedId(overlay.id);
    if (kind === "video") void attachSourceDuration(overlay.id, null, overlay, url);
    showToast({ type: "success", message: "Media added" });
    return true;
  };

  // Files dragged from the computer onto the preview: videos become clips, images overlays.
  // Only OS file drags count, so internal drags and viewport panning are unaffected.
  const fileDragDepthRef = useRef(0);
  const [fileDragOver, setFileDragOver] = useState(false);
  const isFileDrag = (event: React.DragEvent) => event.dataTransfer.types.includes("Files");
  const endFileDrag = () => {
    fileDragDepthRef.current = 0;
    setFileDragOver(false);
  };
  const stageDropHandlers = {
    onDragEnter: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      fileDragDepthRef.current += 1;
      setFileDragOver(true);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
      if (fileDragDepthRef.current === 0) setFileDragOver(false);
    },
    onDragEnd: endFileDrag,
    onDrop: (event: React.DragEvent) => {
      if (!isFileDrag(event)) return;
      event.preventDefault();
      endFileDrag();
      // A Re-pick whose file dialog was dismissed must not capture this drop.
      repickLayerIdRef.current = null;
      for (const file of Array.from(event.dataTransfer.files)) {
        if (!onUpload(file, file.type.startsWith("image/") ? "image" : "sequence")) break;
      }
    },
  };

  // Replaces a layer's missing device file in one history step, keeping its timing
  // (clamped if the new file is shorter).
  const repickMedia = async (layerId: string, file: File) => {
    const { localMediaId, url } = keepDeviceFile(file);
    // Bounded: a probe that never reports metadata must not block the re-pick.
    const sourceSec = file.type.startsWith("video/")
      ? await Promise.race([
          probeVideoDurationSec(url).catch(() => null),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ])
      : null;
    const clip = (c: EditorClip): EditorClip => {
      const next = { ...c, localMediaId, sourceDurationSec: null };
      return sourceSec != null ? withProbedClipSource(next, sourceSec, false) : next;
    };
    const overlay = (o: EditorOverlay): EditorOverlay => {
      const next = { ...o, localMediaId, sourceDurationSec: o.kind === "video" ? null : o.sourceDurationSec };
      return sourceSec != null ? withProbedOverlaySource(next, sourceSec, false) : next;
    };
    fittedOverlaysRef.current.delete(layerId);
    patchDoc((current) => ({
      ...current,
      sequence: current.sequence.map((c) => (c.id === layerId ? clip(c) : c)),
      overlays: current.overlays.map((o) => (o.id === layerId ? overlay(o) : o)),
    }));
  };

  const openFilePicker = (kind: "sequence" | "image" | "video", repickLayerId: string | null = null) => {
    const input = uploadRef.current;
    if (!input) return;
    uploadKindRef.current = kind;
    repickLayerIdRef.current = repickLayerId;
    input.accept = kind === "image" ? "image/jpeg,image/png,image/webp" : "video/mp4,video/quicktime,video/webm";
    input.click();
  };

  const pickRepick = (layer: EditorClip | EditorOverlay) =>
    openFilePicker("kind" in layer ? (layer.kind === "image" ? "image" : "video") : "sequence", layer.id);

  const updateClip = (id: string, patch: Partial<EditorClip>, opts?: { coalesceKey?: string; keepPlaying?: boolean }) => {
    const next: Partial<EditorClip> = { ...patch };
    if (next.startSec != null) next.startSec = snapTenth(next.startSec);
    if (next.endSec != null) next.endSec = snapTenth(next.endSec);
    if (next.inSec != null) next.inSec = snapTenth(next.inSec);
    patchDoc((current) => ({
      ...current,
      sequence: current.sequence.map((clip) =>
        clip.id === id
          ? clampClipToComposition({ ...clip, ...next })
          : clip
      ),
    }), opts);
  };

  const updateOverlay = (id: string, patch: Partial<EditorOverlay>, opts?: { coalesceKey?: string; keepPlaying?: boolean }) => {
    const next: Partial<EditorOverlay> = { ...patch };
    if (next.startSec != null) next.startSec = snapTenth(next.startSec);
    if (next.endSec != null) next.endSec = snapTenth(next.endSec);
    patchDoc((current) => ({
      ...current,
      overlays: current.overlays.map((overlay) =>
        overlay.id === id
          ? clampOverlayToComposition({ ...overlay, ...next })
          : overlay
      ),
    }), opts);
  };

  // Image and PiP overlays can carry stale w/h from before the box tracked the
  // media's real shape (or from manual resizes against a since-changed aspect
  // ratio), producing a box that letterboxes the media inside it. Once the
  // browser reports the media's actual pixel size, snap the box to match — same
  // center, clamped to the canvas — so the outline hugs the visible image.
  const fitOverlayToNaturalSize = (id: string, naturalWidth: number, naturalHeight: number) => {
    if (naturalWidth <= 0 || naturalHeight <= 0) return;
    if (fittedOverlaysRef.current.has(id)) return;
    fittedOverlaysRef.current.add(id);
    const overlay = docRef.current.overlays.find((o) => o.id === id);
    if (!overlay) return;
    const naturalRatio = naturalWidth / naturalHeight;
    const pixelW = overlay.w * canvas.w;
    const pixelH = overlay.h * canvas.h;
    if (Math.abs(pixelW / pixelH - naturalRatio) < 0.02) return;
    let newPixelH = pixelH;
    let newPixelW = newPixelH * naturalRatio;
    if (newPixelW > canvas.w) {
      newPixelW = canvas.w;
      newPixelH = newPixelW / naturalRatio;
    }
    if (newPixelH > canvas.h) {
      newPixelH = canvas.h;
      newPixelW = newPixelH * naturalRatio;
    }
    const centerX = overlay.x * canvas.w + pixelW / 2;
    const centerY = overlay.y * canvas.h + pixelH / 2;
    const newW = newPixelW / canvas.w;
    const newH = newPixelH / canvas.h;
    updateOverlay(id, {
      w: newW,
      h: newH,
      x: Math.min(Math.max((centerX - newPixelW / 2) / canvas.w, 0), 1 - newW),
      y: Math.min(Math.max((centerY - newPixelH / 2) / canvas.h, 0), 1 - newH),
    });
  };

  const handleExport = async (exportName: string, exportSettings: EditorExportSettings) => {
    if (status !== "authenticated") {
      openSignInModal();
      return;
    }
    if (exportCheck) {
      setExportError(exportCheck.message);
      return;
    }
    const attempt = begin(`${fingerprint}|${exportName}|${JSON.stringify(exportSettings)}`);
    if (!attempt) return;
    lastExportRef.current = { name: exportName, settings: exportSettings };
    resumedExportRef.current = false;
    setExporting(true);
    setExportError(null);
    const startedAt = Date.now();
    const finishExport = (patch: Partial<ExportProgressState>) => {
      setPollKey(null);
      setExportProgress((p) =>
        p ? { ...p, outcome: "failed", cancelling: false, endedAt: Date.now(), ...patch } : p,
      );
      setExportProgressOpen(true);
    };
    setExportProgress({
      outcome: "running",
      stage: [...doc.sequence, ...doc.overlays].some(isLocalOnlyLayer) ? "uploading" : "preparing",
      pct: null,
      uploadDone: 0,
      uploadTotal: 0,
      startedAt,
      endedAt: null,
      error: null,
      creationId: null,
      cancelAllowed: true,
      cancelling: false,
    });
    setExportProgressOpen(true);
    // Device files upload only now, to temp paths the export route deletes when it finishes.
    // The editor's own doc stays local-only; the server gets a copy with storagePath filled.
    const localIds = [
      ...new Set([...doc.sequence, ...doc.overlays].filter(isLocalOnlyLayer).map((l) => l.localMediaId!)),
    ];
    const exportUploads: { localMediaId: string; storagePath: string }[] = [];
    if (localIds.length > 0) {
      const upload = { controller: new AbortController(), paths: [] as string[] };
      const { signal } = upload.controller;
      exportUploadRef.current = upload;
      setExportProgress((p) => (p ? { ...p, uploadTotal: localIds.length } : p));
      try {
        for (const localMediaId of localIds) {
          const file = localFilesRef.current.get(localMediaId);
          if (!file) throw new Error("Re-pick missing media to export.");
          const uploaded = await uploadRefFile(file, {
            signal,
            onSigned: (path) => upload.paths.push(path),
          });
          signal.throwIfAborted();
          exportUploads.push({ localMediaId, storagePath: uploaded.path });
          setExportProgress((p) => (p ? { ...p, uploadDone: exportUploads.length } : p));
        }
        signal.throwIfAborted();
      } catch (err) {
        deleteRefUploads(upload.paths.splice(0));
        attempt.settle(false);
        if (signal.aborted) finishExport({ outcome: "cancelled" });
        else finishExport({ error: err instanceof Error ? err.message : "Couldn't upload media for export." });
        setExporting(false);
        return;
      } finally {
        if (exportUploadRef.current === upload) exportUploadRef.current = null;
      }
    }
    // From here the render route owns the uploads (it deletes them on every exit),
    // so Cancel goes through the generation cancel flow.
    setExportProgress((p) => (p ? { ...p, stage: "preparing", pct: null } : p));
    setPollKey(attempt.key);
    const pathById = new Map(exportUploads.map((u) => [u.localMediaId, u.storagePath]));
    const withUpload = <T extends EditorClip | EditorOverlay>(layer: T): T =>
      isLocalOnlyLayer(layer) ? { ...layer, storagePath: pathById.get(layer.localMediaId!) ?? null } : layer;
    const exportDoc: EditorDocument = {
      ...doc,
      sequence: doc.sequence.map(withUpload),
      overlays: doc.overlays.map(withUpload),
    };
    try {
      const res = await fetch("/api/render-editor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: JSON.stringify({ title: exportName, document: exportDoc, exportUploads, settings: exportSettings }),
        // A dropped connection is not a terminal answer: treat it like 202 and poll the attempt's status.
      }).catch(() => new Response(null, { status: 202 }));
      let data = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        ok?: boolean;
        creation?: { id?: string };
      };
      if (res.status === 401) {
        openSignInModal();
        attempt.settle(false);
        finishExport({ error: "Sign in again to export." });
        return;
      }
      // 202 is non-terminal: stay locked on this attempt until the export reports a terminal status.
      if (res.status === 202) {
        const finished = await pollEditorExport(attempt.key);
        data = finished.data;
        if (!finished.ok) {
          if (data.code === "GENERATION_CANCELLED") {
            attempt.settle(false);
            finishExport({ outcome: "cancelled" });
            return;
          }
          throw new Error(data.error || "Export failed.");
        }
      } else {
        if (res.status === 409 && data.code === "GENERATION_CANCELLED") {
          attempt.settle(false);
          finishExport({ outcome: "cancelled" });
          return;
        }
        if (!res.ok) {
          throw new Error(data.error || "Export failed.");
        }
      }
      attempt.settle(true);
      finishExport({ outcome: "success", creationId: data.creation?.id ?? null });
    } catch (err) {
      attempt.settle(false);
      finishExport({ error: err instanceof Error ? err.message : "Export failed." });
    } finally {
      setExporting(false);
    }
  };

  // Display polling (and the only outcome source after a reload). Never stops on a
  // non-terminal response; backs off while the tab is hidden.
  useEffect(() => {
    if (!pollKey) return;
    let stop = false;
    let timer = 0;
    const tick = async () => {
      try {
        const res = await fetch("/api/generations/status", {
          headers: { "Idempotency-Key": pollKey },
          cache: "no-store",
        });
        if (res.ok && !stop) applyExportStatus(await res.json());
      } catch {
        // transient; next tick retries
      }
      if (!stop) timer = window.setTimeout(tick, document.hidden ? 8000 : 1500);
    };
    timer = window.setTimeout(tick, 400);
    return () => {
      stop = true;
      window.clearTimeout(timer);
    };
    // applyExportStatus only uses setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollKey]);

  function applyExportStatus(data: {
    status?: string;
    cancelAllowed?: boolean;
    progress?: unknown;
    result?: { creation?: { id?: string } } | null;
    error?: { message?: string; code?: string } | null;
  }) {
    if (data.status === "started") {
      const prog = parseExportProgress(data.progress);
      setExportProgress((p) =>
        p && p.outcome === "running"
          ? {
              ...p,
              stage: prog?.stage ?? p.stage,
              pct: prog ? monotonicPct({ stage: p.stage, pct: p.pct }, prog) : p.pct,
              cancelAllowed: data.cancelAllowed !== false,
            }
          : p,
      );
      return;
    }
    if (!resumedExportRef.current) return; // the render fetch settles this attempt
    const patch: Partial<ExportProgressState> | null =
      data.status === "succeeded"
        ? { outcome: "success", creationId: data.result?.creation?.id ?? null }
        : data.status === "failed"
          ? data.error?.code === "GENERATION_CANCELLED"
            ? { outcome: "cancelled" }
            : { outcome: "failed", error: data.error?.message ?? "Export failed." }
          : null;
    if (!patch) return;
    if (data.status === "succeeded") {
      try {
        const attempt = readPersistedIdempotentAttempt(window.sessionStorage, "editor:export");
        if (attempt) clearPersistedIdempotentAttempt(window.sessionStorage, "editor:export", attempt);
      } catch {
        // best effort
      }
    }
    resumedExportRef.current = false;
    setPollKey(null);
    setExporting(false);
    setExportProgress((p) => (p ? { ...p, cancelling: false, endedAt: Date.now(), ...patch } : p));
    setExportProgressOpen(true);
  }

  // Reload during an export: resume the same persisted attempt (never start a second one).
  useEffect(() => {
    if (status !== "authenticated") return;
    let key: string | undefined;
    try {
      key = readPersistedIdempotentAttempt(window.sessionStorage, "editor:export")?.key;
    } catch {
      return;
    }
    if (!key) return;
    let cancelled = false;
    void fetch("/api/generations/status", { headers: { "Idempotency-Key": key }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data || (data.status !== "started" && data.status !== "succeeded")) return;
        resumedExportRef.current = true;
        setExporting(true);
        setExportProgress({
          outcome: "running",
          stage: "preparing",
          pct: null,
          uploadDone: 0,
          uploadTotal: 0,
          startedAt: Date.now(),
          endedAt: null,
          error: null,
          creationId: null,
          cancelAllowed: data.cancelAllowed !== false,
          cancelling: false,
        });
        setExportProgressOpen(true);
        setPollKey(key!);
        if (data.status === "succeeded") applyExportStatus(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [status]);

  // Upload phase: abort and delete this export's uploads here (no generation request exists
  // yet). Render phase: the generation cancel flow; the route deletes the uploads.
  const cancelExport = () => {
    const upload = exportUploadRef.current;
    if (upload) {
      upload.controller.abort();
      deleteRefUploads(upload.paths.splice(0));
      return;
    }
    const key = pollKey;
    if (!key) return;
    setExportProgress((p) => (p ? { ...p, cancelling: true } : p));
    void fetch("/api/generations/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idempotencyKey: key }),
    })
      .then(async (res) => {
        if (res.ok) return; // the render settles with a cancelled outcome
        const body = await res.json().catch(() => ({}));
        const notAllowed = res.status === 409 && body?.code === "CANCEL_NOT_ALLOWED";
        setExportProgress((p) =>
          p ? { ...p, cancelling: false, cancelAllowed: notAllowed ? false : p.cancelAllowed } : p,
        );
      })
      .catch(() => setExportProgress((p) => (p ? { ...p, cancelling: false } : p)));
  };

  const retryExport = () => {
    setExportProgressOpen(false);
    const last = lastExportRef.current;
    if (last) void handleExport(last.name, last.settings);
    else setExportDialogOpen(true);
  };

  const applyScale = (next: number, anchorX: number) => {
    const scroller = tracksScrollRef.current;
    const clamped = clampScale(next);
    const old = pxPerSecRef.current;
    if (!scroller || clamped === old || activeTimelineDrags > 0) return;
    const scrollLeft = pendingScrollRef.current ?? scroller.scrollLeft;
    pendingScrollRef.current = anchoredScrollLeft(old, clamped, scrollLeft, anchorX);
    pxPerSecRef.current = clamped;
    preFitScaleRef.current = null;
    setPxPerSec(clamped);
  };
  /** Button, slider and keyboard zoom keep the playhead fixed when visible, else the viewport center. */
  const zoomTo = (next: number) => {
    const scroller = tracksScrollRef.current;
    if (!scroller) return;
    const scrollLeft = pendingScrollRef.current ?? scroller.scrollLeft;
    const playheadX = playhead * pxPerSecRef.current + TIMELINE_PAD_PX - scrollLeft;
    const visible = playheadX >= 0 && playheadX <= scroller.clientWidth;
    applyScale(next, visible ? playheadX : scroller.clientWidth / 2);
  };
  const fitTimeline = () => {
    const scroller = tracksScrollRef.current;
    if (!scroller || activeTimelineDrags > 0) return;
    const current = pxPerSecRef.current;
    const fitted = fitPxPerSec(duration, scroller.clientWidth - TIMELINE_PAD_PX * 2);
    const previous = preFitScaleRef.current;
    // Pressing Fit again at the fitted scale restores the previous zoom.
    const target = previous !== null && Math.abs(current - fitted) < 0.01 ? previous : fitted;
    if (Math.abs(target - current) < 0.01) return;
    pendingScrollRef.current = 0;
    pxPerSecRef.current = target;
    setPxPerSec(target);
    preFitScaleRef.current = target === previous ? null : current;
  };
  useLayoutEffect(() => {
    zoomActionsRef.current = { zoomBy: (dir) => zoomTo(stepScale(pxPerSecRef.current, dir)), fit: fitTimeline };
    applyScaleRef.current = applyScale;
  });

  useLayoutEffect(() => {
    const pending = pendingScrollRef.current;
    const scroller = tracksScrollRef.current;
    if (pending === null || !scroller) return;
    pendingScrollRef.current = null;
    scroller.scrollLeft = pending;
    if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = scroller.scrollLeft;
  }, [pxPerSec]);

  // Non-passive wheel listener: Ctrl/Cmd+wheel (and trackpad pinch) zooms around the pointer;
  // plain and shift wheel keep scrolling natively. One zoom update per animation frame.
  useEffect(() => {
    const scroller = tracksScrollRef.current;
    if (!scroller) return;
    let factor = 1;
    let anchorX = 0;
    let frame = 0;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      factor *= Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002));
      anchorX = event.clientX - scroller.getBoundingClientRect().left;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const f = factor;
        factor = 1;
        applyScaleRef.current(pxPerSecRef.current * f, anchorX);
      });
    };
    const ruler = rulerScrollRef.current;
    scroller.addEventListener("wheel", onWheel, { passive: false });
    ruler?.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      scroller.removeEventListener("wheel", onWheel);
      ruler?.removeEventListener("wheel", onWheel);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  // Visible width and coarse scroll bucket drive which ruler ticks are rendered.
  useEffect(() => {
    const scroller = tracksScrollRef.current;
    if (!scroller) return;
    const measure = () =>
      setRulerView((v) => {
        const bucket = Math.floor(scroller.scrollLeft / RULER_BUCKET_PX);
        return v.width === scroller.clientWidth && v.bucket === bucket
          ? v
          : { width: scroller.clientWidth, bucket };
      });
    measureViewportRef.current = measure;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, []);

  // Fit once per project load, after the document is applied and the scroller has a width.
  // Never re-runs on edits or resizes: the flag is only set by loadProject.
  useLayoutEffect(() => {
    if (!fitOnOpenRef.current) return;
    const scroller = tracksScrollRef.current;
    if (!scroller || scroller.clientWidth <= 0) return;
    fitOnOpenRef.current = false;
    if (doc.sequence.length === 0 && doc.overlays.length === 0) {
      setScaleAndRewind(DEFAULT_PX_PER_SEC);
      return;
    }
    setScaleAndRewind(openFitPxPerSec(duration, scroller.clientWidth - TIMELINE_PAD_PX * 2));
  }, [doc, duration, rulerView.width, setScaleAndRewind]);

  // Small headroom past the last layer so strips can be dragged longer; the project itself ends at `duration`.
  const timelineSec = Math.min(EDITOR_MAX_DURATION_SEC, duration + FIT_MARGIN_SEC);
  const timelineWidth = Math.max(rulerView.width - TIMELINE_PAD_PX * 2, 320, Math.ceil(timelineSec * pxPerSec));
  const laneWidth = duration * pxPerSec;

  return (
    <div className="flex h-full min-h-0 flex-col bg-N50 text-text-primary">
      <EditorTopBar
        title={title}
        dirty={dirty}
        saving={saving}
        exportReady={!exportCheck && duration > 0}
        exporting={exporting}
        exportChip={
          exporting && exportProgress
            ? exportProgress.pct == null
              ? "Exporting…"
              : `Exporting… ${exportProgress.pct}%`
            : null
        }
        onTitleChange={setTitle}
        onTitleCommit={(value) => void commitTitle(value)}
        onSave={() => void handleSave()}
        onOpen={() => {
          if (status !== "authenticated") {
            openSignInModal();
            return;
          }
          setOpenList(true);
        }}
        onExport={() => {
          if (status !== "authenticated") {
            openSignInModal();
            return;
          }
          if (exporting) setExportProgressOpen(true);
          else setExportDialogOpen(true);
        }}
      />

      {exportProgress ? (
        <EditorExportProgressDialog
          open={exportProgressOpen}
          state={exportProgress}
          onClose={() => setExportProgressOpen(false)}
          onCancel={cancelExport}
          onRetry={retryExport}
          onOpenLibrary={(id) => {
            setExportProgressOpen(false);
            void openPreview(id);
          }}
        />
      ) : null}

      {exportDialogOpen ? (
        <EditorExportDialog
          defaultName={exportTimestampName()}
          onClose={() => setExportDialogOpen(false)}
          onConfirm={(name, exportSettings) => {
            setExportDialogOpen(false);
            void handleExport(name, exportSettings);
          }}
        />
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            ref={stageRef}
            className={`relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-surface p-4 touch-none ${
              viewport.panning
                ? "cursor-grabbing"
                : viewport.spacePanning || tool === "hand"
                  ? "cursor-grab"
                  : ""
            }`}
            {...viewport.stageHandlers}
            {...stageDropHandlers}
            onClick={() => setSelectedId(null)}
          >
            {fileDragOver ? (
              <div className="pointer-events-none absolute inset-2 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-brand-primary bg-brand-primary/10 ring-2 ring-brand-primary/30">
                <span className="rounded-lg bg-N50/90 px-3 py-1.5 text-xs font-medium text-text-primary">
                  Drop videos or images to add them
                </span>
              </div>
            ) : null}
            <div
              className="relative max-h-full max-w-full"
              style={{
                width: previewSize.width || undefined,
                height: previewSize.height || undefined,
                transform: viewport.transform,
                transformOrigin: "center",
              }}
            >
            <div
              className="relative h-full w-full overflow-hidden rounded-lg bg-black shadow-2xl ring-1 ring-white/10"
              style={{
                aspectRatio: `${canvas.w} / ${canvas.h}`,
              }}
            >
              <div className={`h-full w-full ${active ? "" : "invisible"}`}>
                <SignedVideo
                  storagePath={(active?.clip ?? lastActiveClipRef.current)?.storagePath ?? null}
                  localUrl={(() => {
                    const shown = active?.clip ?? lastActiveClipRef.current;
                    return shown ? localUrlFor(shown) : null;
                  })()}
                  missing={active ? isMissingMedia(active.clip) : false}
                  currentTime={active ? active.localSec : lastActiveLocalSecRef.current}
                  playing={playing && !!active}
                  muted={active?.clip.muted ?? false}
                  videoRef={(node) => {
                    previewVideoRef.current = node;
                  }}
                />
              </div>
              <div className="hidden" aria-hidden>
                {underlying.map(({ clip, localSec }) => (
                  <SignedVideo
                    key={clip.id}
                    storagePath={clip.storagePath}
                    localUrl={localUrlFor(clip)}
                    currentTime={localSec}
                    playing={playing}
                    videoRef={(node) => {
                      if (node) underlyingVideosRef.current.set(clip.id, node);
                      else underlyingVideosRef.current.delete(clip.id);
                    }}
                  />
                ))}
              </div>
              {!active && doc.sequence.length === 0 ? (
                <div className="pointer-events-none absolute inset-0 flex h-full min-h-[240px] items-center justify-center px-6 text-center text-sm text-text-secondary">
                  Add a clip from My Library or upload a video to start editing.
                </div>
              ) : null}
              {overlays.map((overlay) => {
                const visible =
                  !overlay.hidden && playhead >= overlay.startSec && playhead < overlay.endSec;
                const selected = overlay.id === selectedId;
                return (
                  <div
                    key={overlay.id}
                    role="button"
                    tabIndex={visible ? 0 : -1}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(overlay.id);
                    }}
                    onPointerDown={(event) => {
                      if (!visible || !selected || overlay.locked) return;
                      event.stopPropagation();
                      const stage = event.currentTarget.parentElement;
                      if (!stage) return;
                      const rect = stage.getBoundingClientRect();
                      const startX = event.clientX;
                      const startY = event.clientY;
                      const orig = { x: overlay.x, y: overlay.y };
                      const move = (ev: PointerEvent) => {
                        const dx = (ev.clientX - startX) / rect.width;
                        const dy = (ev.clientY - startY) / rect.height;
                        updateOverlay(
                          overlay.id,
                          {
                            x: Math.min(1 - overlay.w, Math.max(0, orig.x + dx)),
                            y: Math.min(1 - overlay.h, Math.max(0, orig.y + dy)),
                          },
                          { coalesceKey: `move:${overlay.id}` }
                        );
                      };
                      const up = () => {
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", up);
                      };
                      window.addEventListener("pointermove", move);
                      window.addEventListener("pointerup", up);
                    }}
                    className={`absolute select-none overflow-hidden ${visible ? "" : "invisible"} ${selected ? "ring-2 ring-brand-primary" : ""}`}
                    style={{
                      left: `${overlay.x * 100}%`,
                      top: `${overlay.y * 100}%`,
                      width: `${overlay.w * 100}%`,
                      height: `${overlay.h * 100}%`,
                      zIndex: overlay.z + 1,
                    }}
                  >
                    {overlay.kind === "text" ? (() => {
                      const layout = textOverlayLayout(overlay, canvas);
                      const scale = (previewSize.width || canvas.w) / canvas.w;
                      const previewFontSize = Math.max(1, layout.fontSize * scale);
                      const previewShadowX = layout.shadow.x * scale;
                      const previewShadowY = layout.shadow.y * scale;

                      return (
                        <div
                          className={`${poppins.className} flex h-full w-full items-center justify-center text-center font-extrabold whitespace-pre`}
                          style={{
                            color: overlay.color || "#FFFFFF",
                            fontSize: previewFontSize,
                            lineHeight: layout.lineHeight,
                            textShadow: `${previewShadowX}px ${previewShadowY}px 0px ${layout.shadow.colorCss}`,
                          }}
                        >
                          {overlay.text}
                        </div>
                      );
                    })() : overlay.kind === "image" ? (
                      <SignedImage
                        storagePath={overlay.storagePath}
                        localUrl={localUrlFor(overlay)}
                        missing={isMissingMedia(overlay)}
                        onNaturalSize={(naturalW, naturalH) => fitOverlayToNaturalSize(overlay.id, naturalW, naturalH)}
                      />
                    ) : (
                      <SignedVideo
                        storagePath={overlay.storagePath}
                        localUrl={localUrlFor(overlay)}
                        missing={isMissingMedia(overlay)}
                        currentTime={overlay.inSec ?? 0}
                        playing={playing && visible}
                        muted={overlay.muted ?? false}
                        onNaturalSize={(naturalW, naturalH) => fitOverlayToNaturalSize(overlay.id, naturalW, naturalH)}
                      />
                    )}
                    {visible && selected && !overlay.locked ? (
                      <div
                        className="absolute -bottom-1 -right-1 h-3 w-3 cursor-se-resize rounded-sm bg-brand-primary"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          const stage = event.currentTarget.parentElement?.parentElement;
                          if (!stage) return;
                          const rect = stage.getBoundingClientRect();
                          const startX = event.clientX;
                          const startY = event.clientY;
                          const orig = { w: overlay.w, h: overlay.h };
                          const move = (ev: PointerEvent) => {
                            updateOverlay(
                              overlay.id,
                              {
                                w: Math.min(1 - overlay.x, Math.max(0.05, orig.w + (ev.clientX - startX) / rect.width)),
                                h: Math.min(1 - overlay.y, Math.max(0.05, orig.h + (ev.clientY - startY) / rect.height)),
                              },
                              { coalesceKey: `resize:${overlay.id}` }
                            );
                          };
                          const up = () => {
                            window.removeEventListener("pointermove", move);
                            window.removeEventListener("pointerup", up);
                          };
                          window.addEventListener("pointermove", move);
                          window.addEventListener("pointerup", up);
                        }}
                      />
                    ) : null}
                  </div>
                );
              })}
            </div>
            </div>

            <EditorPreviewToolbar
              tool={tool}
              onToolChange={setTool}
              zoomPercent={viewport.zoomPercent}
              canZoomIn={viewport.canZoomIn}
              canZoomOut={viewport.canZoomOut}
              onZoomIn={viewport.zoomIn}
              onZoomOut={viewport.zoomOut}
              onSetZoom={viewport.setZoom}
              onFit={viewport.fit}
              canUndo={past.length > 0}
              canRedo={future.length > 0}
              onUndo={undo}
              onRedo={redo}
            />
          </div>

          <div className="flex shrink-0 flex-col bg-N50">
            <div
              role="separator"
              aria-orientation="horizontal"
              onPointerDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const startY = event.clientY;
                const startHeight = tracksHeight;
                const move = (ev: PointerEvent) => {
                  setTracksHeight(
                    Math.max(
                      TIMELINE_TRACKS_MIN_HEIGHT,
                      Math.min(TIMELINE_TRACKS_MAX_HEIGHT, startHeight - (ev.clientY - startY))
                    )
                  );
                };
                const up = () => {
                  window.removeEventListener("pointermove", move);
                  window.removeEventListener("pointerup", up);
                };
                window.addEventListener("pointermove", move);
                window.addEventListener("pointerup", up);
              }}
              className="h-1.5 shrink-0 cursor-row-resize bg-white/10 hover:bg-brand-primary/50 active:bg-brand-primary"
            />
            <div className="grid grid-cols-1 items-center gap-2 border-b border-white/10 md:grid-cols-[1fr_auto_1fr] px-3 py-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <div ref={addMenuRef} className="relative">
                  <button
                    type="button"
                    aria-haspopup="true"
                    aria-expanded={addMenuOpen}
                    onClick={() => setAddMenuOpen((current) => !current)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-xs font-medium hover:bg-white/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                    <ChevronDown className="h-3 w-3 opacity-70" />
                  </button>
                  {addMenuOpen ? (
                    <div
                      role="menu"
                      aria-label="Add to timeline"
                      className="absolute left-0 top-full z-30 mt-1 w-44 rounded-lg border border-white/10 bg-N50 p-1 text-text-primary shadow-xl"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAddMenuOpen(false);
                          openLibrary({ mediaType: "video", title: "Add a clip", onPick: addClip });
                        }}
                        disabled={doc.sequence.length >= EDITOR_MAX_SEQUENCE}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Clip
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={doc.sequence.length >= EDITOR_MAX_SEQUENCE}
                        onClick={() => {
                          setAddMenuOpen(false);
                          openFilePicker("sequence");
                        }}
                        className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary disabled:opacity-40 disabled:cursor-not-allowed"
                        title={`Upload video from device (max ${EDITOR_MAX_UPLOAD_MB} MB)`}
                      >
                        <span className="flex items-center gap-2">
                          <Upload className="h-3.5 w-3.5" />
                          Upload
                        </span>
                        <span className="text-[10px] text-text-secondary">Max {EDITOR_MAX_UPLOAD_MB} MB</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAddMenuOpen(false);
                          if (doc.overlays.length >= EDITOR_MAX_OVERLAYS) return;
                          const { start, end } = placeLayer(playhead, 3);
                          const overlay = textOverlay(start, end, doc.overlays.length);
                          patchDoc((current) => ({ ...current, overlays: [...current.overlays, overlay] }));
                          setSelectedId(overlay.id);
                        }}
                        disabled={doc.overlays.length >= EDITOR_MAX_OVERLAYS}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Type className="h-3.5 w-3.5" />
                        Text
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAddMenuOpen(false);
                          openLibrary({
                            mediaType: "image",
                            title: "Add an image overlay",
                            onPick: (item) => addOverlayFromItem("image", item),
                          });
                        }}
                        disabled={doc.overlays.length >= EDITOR_MAX_OVERLAYS}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        Image
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setAddMenuOpen(false);
                          openLibrary({
                            mediaType: "video",
                            title: "Add a video overlay",
                            onPick: (item) => addOverlayFromItem("video", item),
                          });
                        }}
                        disabled={doc.overlays.length >= EDITOR_MAX_OVERLAYS}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Video className="h-3.5 w-3.5" />
                        PiP
                      </button>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={handleSplitSelected}
                  disabled={!canSplitSelected}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-xs font-medium hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-white/10"
                  title={canSplitSelected ? "Split clip at playhead (⌘B)" : "Select a clip intersecting playhead to split"}
                  aria-label="Split clip at playhead"
                >
                  <Scissors className="h-3.5 w-3.5" />
                  Split
                </button>
                <input
                  ref={uploadRef}
                  type="file"
                  accept="video/mp4,video/quicktime,video/webm"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) onUpload(file);
                  }}
                />
              </div>

              <div className="flex items-center justify-center gap-1">
                <button
                  type="button"
                  onClick={jumpToClipStart}
                  className="rounded-lg p-1.5 text-text-secondary hover:bg-white/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary"
                  aria-label="Jump to clip start"
                  title="Jump to clip start"
                >
                  <SkipBack className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => stepPlayhead(-0.1)}
                  className="rounded-lg p-1.5 text-text-secondary hover:bg-white/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary"
                  aria-label="Step back"
                  title="Step back"
                >
                  <StepBack className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const el = previewVideoRef.current;
                    if (playing) {
                      el?.pause();
                      setPlaying(false);
                      return;
                    }
                    if (duration <= 0) return;
                    rewindForLoop();
                    const activeClip = currentVisibleClip();
                    if (el && activeClip) {
                      el.muted = Boolean(activeClip.clip.muted);
                      void el.play().catch(() => undefined);
                    }
                    for (const v of underlyingVideosRef.current.values()) void v.play().catch(() => undefined);
                    setPlaying(true);
                  }}
                  className="rounded-lg bg-white/10 p-2 text-text-primary hover:bg-white/15 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary"
                  aria-label={playing ? "Pause" : "Play"}
                  title={playing ? "Pause" : "Play"}
                >
                  {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => stepPlayhead(0.1)}
                  className="rounded-lg p-1.5 text-text-secondary hover:bg-white/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary"
                  aria-label="Step forward"
                  title="Step forward"
                >
                  <StepForward className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={jumpToClipEnd}
                  className="rounded-lg p-1.5 text-text-secondary hover:bg-white/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary"
                  aria-label="Jump to clip end"
                  title="Jump to clip end"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setLoop((current) => !current)}
                  className={`rounded-lg p-1.5 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary ${
                    loop ? "bg-brand-primary/20 text-brand-primary" : "text-text-secondary hover:text-text-primary"
                  }`}
                  aria-pressed={loop}
                  aria-label="Loop playback"
                  title={loop ? "Loop on" : "Loop off"}
                >
                  <Repeat className="h-3.5 w-3.5" />
                </button>
                <span className="ml-1 flex items-center text-xs tabular-nums text-text-secondary">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={timeInputDraft ?? playhead.toFixed(1)}
                    onFocus={(event) => {
                      setTimeInputDraft(playhead.toFixed(1));
                      event.currentTarget.select();
                    }}
                    onChange={(event) => setTimeInputDraft(event.target.value)}
                    onBlur={(event) => commitTimeInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") event.currentTarget.blur();
                      if (event.key === "Escape") {
                        setTimeInputDraft(null);
                        event.currentTarget.blur();
                      }
                    }}
                    aria-label="Jump to time in seconds"
                    title="Type a time in seconds and press Enter to jump"
                    className="w-9 rounded bg-transparent px-0.5 text-right outline-none hover:bg-white/10 focus:bg-white/15 focus-visible:ring-1 focus-visible:ring-brand-primary"
                  />
                  <span>s</span>
                  <span className="text-white/30"> / </span>
                  {formatTimecode(duration)}
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
                  <button
                    type="button"
                    onClick={() => zoomActionsRef.current.zoomBy(-1)}
                    disabled={pxPerSec <= MIN_PX_PER_SEC}
                    className="rounded-md p-1.5 text-text-secondary hover:bg-white/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary disabled:opacity-40 disabled:hover:bg-transparent"
                    aria-label="Zoom timeline out"
                    title="Zoom timeline out (-)"
                  >
                    <ZoomOut className="h-3.5 w-3.5" />
                  </button>
                  <input
                    type="range"
                    min={Math.log(MIN_PX_PER_SEC)}
                    max={Math.log(MAX_PX_PER_SEC)}
                    step={Math.log(ZOOM_STEP) / 10}
                    value={Math.log(pxPerSec)}
                    onChange={(event) => zoomTo(Math.exp(Number(event.target.value)))}
                    aria-label="Zoom timeline"
                    aria-valuetext={`${Math.round(pxPerSec)} pixels per second`}
                    className="hidden h-1 w-24 cursor-pointer accent-brand-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary sm:block"
                  />
                  <button
                    type="button"
                    onClick={() => zoomActionsRef.current.zoomBy(1)}
                    disabled={pxPerSec >= MAX_PX_PER_SEC}
                    className="rounded-md p-1.5 text-text-secondary hover:bg-white/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary disabled:opacity-40 disabled:hover:bg-transparent"
                    aria-label="Zoom timeline in"
                    title="Zoom timeline in (+)"
                  >
                    <ZoomIn className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={fitTimeline}
                    className="rounded-md p-1.5 text-text-secondary hover:bg-white/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary"
                    aria-label="Fit timeline"
                    title="Fit timeline (Shift+Z)"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center gap-0.5 rounded-lg bg-white/5 p-0.5">
                  {EDITOR_ASPECTS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => patchDoc((current) => withProjectAspect(current, value))}
                      className={`rounded-md px-2 py-1 text-[11px] font-semibold tabular-nums focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-primary ${
                        doc.aspect === value
                          ? "bg-white/15 text-text-primary"
                          : "text-text-secondary hover:text-text-primary"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex shrink-0">
              <div className="hidden shrink-0 md:block" style={{ width: panelWidth }} />
              <div className="hidden w-1.5 shrink-0 md:block" />
              <div ref={rulerScrollRef} className="min-w-0 flex-1 overflow-hidden px-3 pt-2 pb-2">
                <div
                  className="relative h-5"
                  style={{ width: timelineWidth }}
                  onPointerDown={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = event.clientX - rect.left;
                    const startPlayhead = snapTenth(Math.max(0, Math.min(Math.max(duration, 0), x / pxPerSec)));
                    setPlayhead(startPlayhead);
                    setPlaying(false);
                    startTimelineDrag(event, pxPerSec, (deltaSec) => {
                      setPlayhead(
                        snapTenth(Math.max(0, Math.min(Math.max(duration, 0), startPlayhead + deltaSec)))
                      );
                    });
                  }}
                >
                  <div
                    className="absolute top-0 z-20 -translate-x-1/2 cursor-ew-resize select-none whitespace-nowrap rounded-[3px] bg-info px-1.5 py-0.5 text-[9px] font-semibold leading-none tabular-nums text-white shadow after:absolute after:left-1/2 after:top-full after:-translate-x-1/2 after:border-x-4 after:border-t-4 after:border-x-transparent after:border-t-info after:content-['']"
                    style={{ left: playhead * pxPerSec }}
                    aria-hidden
                  >
                    {formatTimecode(playhead)}
                  </div>
                  {(() => {
                    const interval = rulerIntervalSec(pxPerSec);
                    const [first, last] = visibleTickRange(
                      rulerView.bucket * RULER_BUCKET_PX - RULER_BUCKET_PX,
                      (rulerView.bucket + 1) * RULER_BUCKET_PX + rulerView.width + RULER_BUCKET_PX,
                      pxPerSec,
                      interval,
                      timelineWidth
                    );
                    return Array.from({ length: last - first + 1 }, (_, n) => {
                      const i = first + n;
                      const t = i * interval;
                      return (
                        <div
                          key={i}
                          className={`absolute top-0 flex flex-col items-start ${t > duration ? "opacity-40" : ""}`}
                          style={{ left: t * pxPerSec }}
                        >
                          <span className={`w-px bg-white/25 ${i % 5 === 0 ? "h-2.5" : "h-1.5"}`} />
                          <span className="mt-0.5 whitespace-nowrap text-[9px] tabular-nums text-text-secondary">
                            {formatRulerLabel(t)}
                          </span>
                        </div>
                      );
                    });
                  })()}
                </div>
              </div>
            </div>

            <div
              className="flex min-h-0 items-start overflow-y-auto"
              style={{ height: Math.max(0, tracksHeight - TIMELINE_RULER_HEIGHT) }}
            >
              <div
                className="hidden shrink-0 flex-col border-r border-white/10 pt-2 pb-11 pl-3 md:flex"
                style={{ width: panelWidth }}
              >
                {overlayRows.length > 0 ? (
                  <div className="mb-2 space-y-1">
                    {overlayRows.map(({ overlay, label }) => (
                      <LayerPanelRow
                        key={overlay.id}
                        id={overlay.id}
                        selected={overlay.id === selectedId}
                        locked={overlay.locked}
                        hidden={overlay.hidden}
                        canMute={overlay.kind === "video"}
                        muted={overlay.kind === "video" ? Boolean(overlay.muted) : undefined}
                        dragOver={dragOverLayerId === overlay.id}
                        icon={
                          overlay.kind === "text" ? (
                            <Type className="h-3 w-3" />
                          ) : overlay.kind === "image" ? (
                            <ImagePlus className="h-3 w-3" />
                          ) : (
                            <Video className="h-3 w-3" />
                          )
                        }
                        label={label}
                        onSelect={() => setSelectedId(overlay.id)}
                        onReorderStart={() => {
                          dragLayerIdRef.current = overlay.id;
                        }}
                        onReorderHover={setDragOverLayerId}
                        onReorderCommit={(targetId) => {
                          const sourceId = dragLayerIdRef.current;
                          dragLayerIdRef.current = null;
                          setDragOverLayerId(null);
                          if (sourceId && targetId) reorderOverlays(sourceId, targetId);
                        }}
                        onToggleLock={() => updateOverlay(overlay.id, { locked: !overlay.locked })}
                        onToggleHidden={() => updateOverlay(overlay.id, { hidden: !overlay.hidden })}
                        onToggleMute={
                          overlay.kind === "video"
                            ? () => updateOverlay(overlay.id, { muted: !overlay.muted }, { keepPlaying: true })
                            : undefined
                        }
                        onRepick={isMissingMedia(overlay) ? () => pickRepick(overlay) : undefined}
                        onDelete={() => removeLayer("overlay", overlay.id)}
                        onRename={(nextName) => updateOverlay(overlay.id, { name: normalizeLayerName(nextName) })}
                      />
                    ))}
                  </div>
                ) : null}
                <div className="space-y-1">
                  {clipRows.length === 0 ? (
                    <div className="h-8" />
                  ) : (
                    clipRows.map(({ clip, label }) => (
                      <LayerPanelRow
                        key={clip.id}
                        id={clip.id}
                        selected={clip.id === selectedId}
                        locked={clip.locked}
                        hidden={clip.hidden}
                        canMute={true}
                        muted={Boolean(clip.muted)}
                        dragOver={dragOverLayerId === clip.id}
                        icon={<Video className="h-3 w-3" />}
                        label={label}
                        onSelect={() => setSelectedId(clip.id)}
                        onReorderStart={() => {
                          dragLayerIdRef.current = clip.id;
                        }}
                        onReorderHover={setDragOverLayerId}
                        onReorderCommit={(targetId) => {
                          const sourceId = dragLayerIdRef.current;
                          dragLayerIdRef.current = null;
                          setDragOverLayerId(null);
                          if (sourceId && targetId) reorderClips(sourceId, targetId);
                        }}
                        onToggleLock={() => updateClip(clip.id, { locked: !clip.locked })}
                        onToggleHidden={() => updateClip(clip.id, { hidden: !clip.hidden })}
                        onToggleMute={() => updateClip(clip.id, { muted: !clip.muted }, { keepPlaying: true })}
                        onRepick={isMissingMedia(clip) ? () => pickRepick(clip) : undefined}
                        onDelete={() => removeLayer("clip", clip.id)}
                        onRename={(nextName) => updateClip(clip.id, { name: normalizeLayerName(nextName) })}
                      />
                    ))
                  )}
                </div>
              </div>

              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize layer panel"
                title="Drag to resize"
                onPointerDown={(event) => {
                  const startWidth = panelWidth;
                  startTimelineDrag(event, 1, (deltaPx) => {
                    setPanelWidth(
                      Math.max(LAYER_PANEL_MIN_WIDTH, Math.min(LAYER_PANEL_MAX_WIDTH, startWidth + deltaPx))
                    );
                  });
                }}
                className="relative hidden w-1.5 shrink-0 cursor-col-resize self-stretch min-h-full touch-none select-none bg-white/10 transition-colors hover:bg-brand-primary/50 active:bg-brand-primary md:block before:absolute before:-left-1 before:-right-1 before:inset-y-0"
              />

              <div
                ref={tracksScrollRef}
                className="min-w-0 flex-1 overflow-x-auto px-3 pt-2 pb-11"
                onScroll={(event) => {
                  if (rulerScrollRef.current) {
                    rulerScrollRef.current.scrollLeft = event.currentTarget.scrollLeft;
                  }
                  measureViewportRef.current();
                }}
              >
                <div
                  className="relative min-h-full"
                  style={{ width: timelineWidth }}
                  onPointerDown={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect();
                    const x = event.clientX - rect.left;
                    const startPlayhead = snapTenth(Math.max(0, Math.min(Math.max(duration, 0), x / pxPerSec)));
                    setPlayhead(startPlayhead);
                    setPlaying(false);
                    startTimelineDrag(event, pxPerSec, (deltaSec) => {
                      setPlayhead(
                        snapTenth(Math.max(0, Math.min(Math.max(duration, 0), startPlayhead + deltaSec)))
                      );
                    });
                  }}
                >
                  <div
                    className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-info"
                    style={{ left: playhead * pxPerSec }}
                  />
                  {overlayRows.length > 0 ? (
                    <div className="mb-2 space-y-1">
                      {overlayRows.map(({ overlay, label }) => (
                        <TimelineLayerRow
                          key={overlay.id}
                          selected={overlay.id === selectedId}
                          locked={overlay.locked}
                          hidden={overlay.hidden}
                          startSec={overlay.startSec}
                          endSec={overlay.endSec}
                          pxPerSec={pxPerSec}
                          trackWidth={timelineWidth}
                          laneWidth={laneWidth}
                          maxEnd={EDITOR_MAX_DURATION_SEC}
                          maxSpan={maxOverlayLayerDurationSec(overlay)}
                          inSec={overlay.kind === "video" ? overlay.inSec ?? 0 : undefined}
                          selectedClassName="bg-white/25 ring-1 ring-white/40"
                          filmstrip={
                            overlay.kind === "video"
                              ? {
                                  storagePath: overlay.storagePath,
                                  localUrl: localUrlFor(overlay),
                                  inSec: overlay.inSec ?? 0,
                                  outSec: (overlay.inSec ?? 0) + overlay.endSec - overlay.startSec,
                                }
                              : undefined
                          }
                          onSelect={() => setSelectedId(overlay.id)}
                          onMove={(startSec, endSec) =>
                            updateOverlay(overlay.id, { startSec, endSec }, { coalesceKey: `tl-move:${overlay.id}` })
                          }
                          onTrimStart={(startSec, inSec) =>
                            updateOverlay(overlay.id, inSec === undefined ? { startSec } : { startSec, inSec }, { coalesceKey: `tl-trim-s:${overlay.id}` })
                          }
                          onTrimEnd={(endSec) =>
                            updateOverlay(overlay.id, { endSec }, { coalesceKey: `tl-trim-e:${overlay.id}` })
                          }
                          label={
                            <>
                              <span className="truncate capitalize">{label}</span>
                              <span className="ml-1 tabular-nums text-text-secondary">
                                {formatTimecode(overlay.startSec)}–{formatTimecode(overlay.endSec)}
                              </span>
                            </>
                          }
                        />
                      ))}
                    </div>
                  ) : null}
                  <div className="space-y-1">
                    {sequence.length === 0 ? (
                      <div className="h-8 rounded-sm bg-white/[0.03]" style={{ width: laneWidth }} />
                    ) : (
                      clipRows.map(({ clip, label }) => {
                        const clipDur = clipLayerDurationSec(clip);
                        return (
                          <TimelineLayerRow
                            key={clip.id}
                            selected={clip.id === selectedId}
                            locked={clip.locked}
                            hidden={clip.hidden}
                            startSec={clip.startSec}
                            endSec={clip.endSec}
                            pxPerSec={pxPerSec}
                            trackWidth={timelineWidth}
                            laneWidth={laneWidth}
                            maxEnd={EDITOR_MAX_DURATION_SEC}
                            maxSpan={maxClipLayerDurationSec(clip)}
                            inSec={clip.inSec}
                            selectedClassName="bg-brand-primary/80 text-white ring-1 ring-white/40"
                            filmstrip={{
                              storagePath: clip.storagePath,
                              localUrl: localUrlFor(clip),
                              inSec: clip.inSec,
                              outSec: clipSourceOutSec(clip),
                            }}
                            onSelect={() => setSelectedId(clip.id)}
                            onMove={(startSec, endSec) =>
                              updateClip(clip.id, { startSec, endSec }, { coalesceKey: `tl-move:${clip.id}` })
                            }
                            onTrimStart={(startSec, inSec) =>
                              updateClip(clip.id, { startSec, inSec }, { coalesceKey: `tl-trim-s:${clip.id}` })
                            }
                            onTrimEnd={(endSec) =>
                              updateClip(clip.id, { endSec }, { coalesceKey: `tl-trim-e:${clip.id}` })
                            }
                            label={
                              <>
                                <span className="truncate">{label}</span>
                                <span className="ml-1 tabular-nums opacity-80">
                                  {formatTimecode(clip.startSec)}–{formatTimecode(clip.endSec)}
                                </span>
                                <span className="ml-1 tabular-nums opacity-60">{formatTimecode(clipDur)}</span>
                              </>
                            }
                          />
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
            {exportError ? (
              <p className="px-3 pb-2 text-xs text-error">{exportError}</p>
            ) : hasMissingMedia ? (
              <p className="px-3 pb-2 text-xs text-warning">Re-pick missing media to export.</p>
            ) : null}
          </div>
        </div>

        <aside className="hidden w-64 shrink-0 border-l border-white/10 p-3 lg:block">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Inspector</p>
          {selectedClip ? (
            <div className="space-y-2 text-xs">
              <p className="font-medium">Clip layer</p>
              <label className="block text-text-secondary">
                Start
                <input
                  type="number"
                  min={0}
                  max={EDITOR_MAX_DURATION_SEC}
                  step={0.1}
                  value={snapTenth(selectedClip.startSec)}
                  onChange={(event) =>
                    updateClip(selectedClip.id, {
                      startSec: Math.max(0, Number(event.target.value) || 0),
                    })
                  }
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-text-primary outline-none hover:bg-white/10 focus:border-brand-primary focus-visible:ring-1 focus-visible:ring-brand-primary"
                />
              </label>
              <label className="block text-text-secondary">
                End
                <input
                  type="number"
                  min={0.1}
                  max={EDITOR_MAX_DURATION_SEC}
                  step={0.1}
                  value={snapTenth(selectedClip.endSec)}
                  onChange={(event) =>
                    updateClip(selectedClip.id, {
                      endSec: Number(event.target.value) || 0,
                    })
                  }
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-text-primary outline-none hover:bg-white/10 focus:border-brand-primary focus-visible:ring-1 focus-visible:ring-brand-primary"
                />
              </label>
              <label className="block text-text-secondary">
                Source in
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={snapTenth(selectedClip.inSec)}
                  onChange={(event) =>
                    updateClip(selectedClip.id, {
                      inSec: Math.max(0, Number(event.target.value) || 0),
                    })
                  }
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-text-primary outline-none hover:bg-white/10 focus:border-brand-primary focus-visible:ring-1 focus-visible:ring-brand-primary"
                />
              </label>
              {selectedClip.sourceDurationSec != null ? (
                <p className="text-text-secondary">
                  Source {formatTimecode(selectedClip.sourceDurationSec)} · layer max{" "}
                  {formatTimecode(maxClipLayerDurationSec(selectedClip))}
                </p>
              ) : null}
              <div className="pt-2 border-t border-white/10 space-y-2">
                <p className="font-medium text-text-secondary">Trim & Split</p>
                <div className="flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={handleSplitSelected}
                    disabled={!canSplitSelected}
                    className="flex w-full items-center justify-center gap-1.5 rounded-md bg-white/10 px-2 py-1.5 text-xs font-medium hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-white/10"
                    title="Split selected clip at current playhead position"
                  >
                    <Scissors className="h-3.5 w-3.5" />
                    Split at playhead (⌘B)
                  </button>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={handleTrimStartToPlayhead}
                      disabled={!canTrimStart}
                      className="rounded-md bg-white/10 px-2 py-1.5 text-xs font-medium hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-white/10 text-center"
                      title="Trim start of clip to playhead"
                    >
                      Trim Start
                    </button>
                    <button
                      type="button"
                      onClick={handleTrimEndToPlayhead}
                      disabled={!canTrimEnd}
                      className="rounded-md bg-white/10 px-2 py-1.5 text-xs font-medium hover:bg-white/15 disabled:opacity-40 disabled:hover:bg-white/10 text-center"
                      title="Trim end of clip to playhead"
                    >
                      Trim End
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : selectedOverlay ? (
            <div className="space-y-2 text-xs">
              <p className="font-medium capitalize">{selectedOverlay.kind} overlay</p>
              {selectedOverlay.kind === "text" ? (
                <>
                  <label className="block text-text-secondary">
                    Text
                    <textarea
                      rows={2}
                      value={selectedOverlay.text ?? ""}
                      onChange={(event) => updateOverlay(selectedOverlay.id, { text: event.target.value.slice(0, 200) })}
                      className="mt-1 w-full resize-y rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-text-primary outline-none hover:bg-white/10 focus:border-brand-primary focus-visible:ring-1 focus-visible:ring-brand-primary"
                    />
                  </label>
                  <label className="block text-text-secondary">
                    Color
                    <input
                      type="color"
                      value={selectedOverlay.color || "#ffffff"}
                      onChange={(event) => updateOverlay(selectedOverlay.id, { color: event.target.value })}
                      className="mt-1 h-8 w-full cursor-pointer rounded-md border border-white/10 bg-white/5 px-1 py-0.5 outline-none hover:bg-white/10 focus:border-brand-primary focus-visible:ring-1 focus-visible:ring-brand-primary"
                    />
                  </label>
                  <label className="block text-text-secondary">
                    Size
                    <input
                      type="number"
                      min={12}
                      max={200}
                      value={selectedOverlay.fontSize ?? 48}
                      onChange={(event) =>
                        updateOverlay(selectedOverlay.id, { fontSize: Number(event.target.value) || 48 })
                      }
                      className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-text-primary outline-none hover:bg-white/10 focus:border-brand-primary focus-visible:ring-1 focus-visible:ring-brand-primary"
                    />
                  </label>
                </>
              ) : null}
              <label className="block text-text-secondary">
                Start
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={snapTenth(selectedOverlay.startSec)}
                  onChange={(event) =>
                    updateOverlay(selectedOverlay.id, { startSec: Math.max(0, Number(event.target.value) || 0) })
                  }
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-text-primary outline-none hover:bg-white/10 focus:border-brand-primary focus-visible:ring-1 focus-visible:ring-brand-primary"
                />
              </label>
              <label className="block text-text-secondary">
                End
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={snapTenth(selectedOverlay.endSec)}
                  onChange={(event) =>
                    updateOverlay(selectedOverlay.id, { endSec: Number(event.target.value) || 0 })
                  }
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-text-primary outline-none hover:bg-white/10 focus:border-brand-primary focus-visible:ring-1 focus-visible:ring-brand-primary"
                />
              </label>
              <label className="block text-text-secondary">
                Layer
                <input
                  type="number"
                  min={0}
                  max={32}
                  value={selectedOverlay.z}
                  onChange={(event) =>
                    updateOverlay(selectedOverlay.id, { z: Math.round(Number(event.target.value) || 0) })
                  }
                  className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-text-primary outline-none hover:bg-white/10 focus:border-brand-primary focus-visible:ring-1 focus-visible:ring-brand-primary"
                />
              </label>
            </div>
          ) : (
            <p className="text-xs text-text-secondary">
              The video ends where the last layer ends. Select a clip or overlay to place it on the timeline.
            </p>
          )}
        </aside>
      </div>

      <EditorSavedList
        open={openList}
        activeId={projectId}
        onClose={() => setOpenList(false)}
        onSelect={(id) => {
          setOpenList(false);
          void loadProject(id).catch((err) => window.alert(err instanceof Error ? err.message : "Couldn't open."));
        }}
        onNew={() => {
          setOpenList(false);
          resetProject();
        }}
        onDeleted={(id) => {
          if (id === projectIdRef.current) resetProject();
        }}
        onRenamed={(id, nextTitle) => {
          if (id === projectIdRef.current) {
            setTitle(nextTitle);
            persistedTitleRef.current = nextTitle;
          }
        }}
      />

      {toast ? <EditorToast toast={toast} onDismiss={dismissToast} /> : null}
    </div>
  );
}
