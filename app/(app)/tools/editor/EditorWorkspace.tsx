"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  ImagePlus,
  Pause,
  Play,
  Plus,
  Trash2,
  Type,
  Upload,
  Video,
} from "lucide-react";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import { useSignedMediaUrl } from "@/lib/use-signed-media-url";
import { useIdempotentSubmit } from "@/lib/use-idempotent-submit";
import { canDropOnEditor } from "@/lib/editor-handoff";
import { uploadRefFile } from "@/components/studio/RefGroup";
import { fetchSignedUrl } from "@/lib/storage-sign-client";
import { probeVideoDurationSec } from "@/lib/use-video-duration";
import type { CreationHistoryItem } from "@/lib/creations";
import {
  DEFAULT_EDITOR_TITLE,
  EDITOR_ASPECTS,
  EDITOR_CANVAS,
  EDITOR_MAX_DURATION_SEC,
  EDITOR_MAX_OVERLAYS,
  EDITOR_MAX_SEQUENCE,
  clampClipToComposition,
  clampOverlayToComposition,
  clipAtPlayhead,
  clipLayerDurationSec,
  emptyEditorDocument,
  maxClipLayerDurationSec,
  normalizeEditorTitle,
  parseEditorDocument,
  projectDurationSec,
  sequenceDurationSec,
  sortedOverlays,
  sortedSequence,
  validateEditorExport,
  withProjectDuration,
  type EditorAspect,
  type EditorClip,
  type EditorDocument,
  type EditorOverlay,
} from "@/lib/editor-document";
import EditorTopBar from "./EditorTopBar";
import { useEditorLibrary } from "./EditorLibraryPicker";
import EditorSavedList from "./EditorSavedList";

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

function startTimelineDrag(
  event: ReactPointerEvent,
  pxPerSec: number,
  onMove: (deltaSec: number) => void
): void {
  event.preventDefault();
  event.stopPropagation();
  const startX = event.clientX;
  const move = (ev: PointerEvent) => {
    onMove((ev.clientX - startX) / pxPerSec);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

function fingerprintOf(title: string, doc: EditorDocument): string {
  return JSON.stringify({ title: normalizeEditorTitle(title), document: doc });
}

function placeClipStart(playheadSec: number, durationSec: number, preferredSpan = 3): number {
  const duration = Math.max(0.1, durationSec);
  const span = Math.min(preferredSpan, duration);
  if (playheadSec + 0.2 <= duration) {
    return snapTenth(Math.min(playheadSec, Math.max(0, duration - 0.1)));
  }
  return snapTenth(Math.max(0, duration - span));
}

function newClipLayer(
  source: { creationId: string | null; storagePath: string | null },
  order: number,
  startSec: number,
  durationSec: number
): EditorClip {
  const start = placeClipStart(startSec, durationSec);
  const span = Math.min(3, Math.max(0.1, durationSec - start));
  return {
    id: newId("clip"),
    creationId: source.creationId,
    storagePath: source.storagePath,
    startSec: start,
    endSec: snapTenth(start + span),
    inSec: 0,
    sourceDurationSec: null,
    order,
  };
}

function clipFromLibrary(item: CreationHistoryItem, order: number, startSec: number, durationSec: number): EditorClip {
  return newClipLayer(
    { creationId: item.id, storagePath: item.storagePath?.trim() || null },
    order,
    startSec,
    durationSec
  );
}

function clipFromUpload(storagePath: string, order: number, startSec: number, durationSec: number): EditorClip {
  return newClipLayer({ creationId: null, storagePath }, order, startSec, durationSec);
}

function TimelineLayerRow({
  selected,
  startSec,
  endSec,
  pxPerSec,
  trackWidth,
  maxEnd,
  maxSpan,
  label,
  selectedClassName,
  onSelect,
  onMove,
  onTrimStart,
  onTrimEnd,
}: {
  selected: boolean;
  startSec: number;
  endSec: number;
  pxPerSec: number;
  trackWidth: number;
  maxEnd: number;
  maxSpan: number;
  label: ReactNode;
  selectedClassName: string;
  onSelect: () => void;
  onMove: (startSec: number, endSec: number) => void;
  onTrimStart: (startSec: number) => void;
  onTrimEnd: (endSec: number) => void;
}) {
  const span = Math.max(0.2, endSec - startSec);
  const width = Math.max(28, span * pxPerSec);
  return (
    <div className="relative h-8 rounded-sm bg-white/[0.03]" style={{ width: trackWidth }}>
      <div
        role="button"
        tabIndex={0}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).dataset.trim) return;
          const origStart = startSec;
          const origEnd = endSec;
          const origSpan = Math.max(0.2, origEnd - origStart);
          startTimelineDrag(event, pxPerSec, (delta) => {
            const nextStart = Math.max(0, Math.min(maxEnd - origSpan, origStart + delta));
            onMove(nextStart, nextStart + origSpan);
          });
        }}
        className={`absolute inset-y-0 flex cursor-grab items-center rounded-md active:cursor-grabbing ${
          selected ? selectedClassName : "bg-white/10"
        }`}
        style={{ left: startSec * pxPerSec, width }}
      >
        <span
          data-trim="start"
          className="absolute inset-y-0 left-0 z-10 w-1.5 cursor-ew-resize rounded-l-md bg-white/50"
          onPointerDown={(event) => {
            const origStart = startSec;
            const origEnd = endSec;
            const minStart = Math.max(0, origEnd - maxSpan);
            startTimelineDrag(event, pxPerSec, (delta) => {
              onTrimStart(Math.max(minStart, Math.min(origEnd - 0.2, origStart + delta)));
            });
          }}
        />
        <span className="min-w-0 flex-1 truncate px-2 text-left text-[10px] leading-8">
          {label}
        </span>
        <span
          data-trim="end"
          className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-ew-resize rounded-r-md bg-white/50"
          onPointerDown={(event) => {
            const origStart = startSec;
            const origEnd = endSec;
            const cap = Math.min(maxEnd, origStart + maxSpan);
            startTimelineDrag(event, pxPerSec, (delta) => {
              onTrimEnd(Math.max(origStart + 0.2, Math.min(cap, origEnd + delta)));
            });
          }}
        />
      </div>
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
  };
}

function mediaOverlay(
  kind: "image" | "video",
  item: { id?: string; storagePath?: string | null },
  startSec: number,
  endSec: number,
  z: number
): EditorOverlay {
  return {
    id: newId("ov"),
    kind,
    startSec: snapTenth(startSec),
    endSec: snapTenth(endSec),
    x: 0.62,
    y: 0.06,
    w: 0.32,
    h: 0.24,
    z,
    text: null,
    fontSize: null,
    color: null,
    creationId: item.id ?? null,
    storagePath: item.storagePath?.trim() || null,
  };
}

function SignedVideo({
  storagePath,
  currentTime,
  playing,
}: {
  storagePath: string | null;
  currentTime: number;
  playing: boolean;
}) {
  const url = useSignedMediaUrl(storagePath);
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !url) return;
    const gap = Math.abs(el.currentTime - currentTime);
    if (gap > 0.18) el.currentTime = Math.max(0, currentTime);
    if (playing) void el.play().catch(() => undefined);
    else el.pause();
  }, [currentTime, playing, url]);

  if (!url) {
    return <div className="h-full w-full animate-pulse bg-white/5" />;
  }
  return (
    <video
      ref={ref}
      src={url}
      muted
      playsInline
      className="h-full w-full object-contain"
    />
  );
}

function SignedImage({ storagePath }: { storagePath: string | null }) {
  const url = useSignedMediaUrl(storagePath);
  if (!url) return <div className="h-full w-full animate-pulse bg-white/10" />;
  return (
    <Image src={url} alt="" fill sizes="240px" className="object-contain" />
  );
}

export default function EditorWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const { openLibrary } = useEditorLibrary();
  const { begin, cancel, cancelling } = useIdempotentSubmit("editor:export");

  const [title, setTitle] = useState(DEFAULT_EDITOR_TITLE);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [doc, setDoc] = useState<EditorDocument>(emptyEditorDocument);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [saving, setSaving] = useState(false);
  const [openList, setOpenList] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const titleRef = useRef(title);
  const docRef = useRef(doc);
  const projectIdRef = useRef(projectId);
  const lastSavedRef = useRef(fingerprintOf(DEFAULT_EDITOR_TITLE, emptyEditorDocument()));
  const persistedTitleRef = useRef(DEFAULT_EDITOR_TITLE);
  const playStartPerf = useRef(0);
  const playStartHead = useRef(0);
  const creationLinkRef = useRef(false);
  const uploadRef = useRef<HTMLInputElement>(null);
  const uploadKindRef = useRef<"sequence" | "image" | "video">("sequence");
  titleRef.current = title;
  docRef.current = doc;
  projectIdRef.current = projectId;

  const duration = sequenceDurationSec(doc);
  const exportCheck = validateEditorExport(doc);
  const fingerprint = useMemo(() => fingerprintOf(title, doc), [title, doc]);
  const dirty = fingerprint !== lastSavedRef.current;
  const sequence = sortedSequence(doc);
  const overlays = sortedOverlays(doc);
  const active = clipAtPlayhead(doc, playhead);
  const canvas = EDITOR_CANVAS[doc.aspect];
  const selectedClip = doc.sequence.find((c) => c.id === selectedId) ?? null;
  const selectedOverlay = doc.overlays.find((o) => o.id === selectedId) ?? null;

  const applyUrl = useCallback(
    (id: string | null) => {
      const url = id ? `/tools/editor?projectId=${encodeURIComponent(id)}` : "/tools/editor";
      router.replace(url, { scroll: false });
    },
    [router]
  );

  const patchDoc = useCallback((updater: (current: EditorDocument) => EditorDocument) => {
    setDoc((current) => updater(current));
    setPlaying(false);
  }, []);

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
      setSelectedId(null);
      setPlayhead(0);
      setPlaying(false);
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
    setSelectedId(null);
    setPlayhead(0);
    setPlaying(false);
    lastSavedRef.current = fingerprintOf(DEFAULT_EDITOR_TITLE, empty);
    applyUrl(null);
  }, [applyUrl]);

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
        setDoc((current) => {
          const duration = projectDurationSec(current);
          return {
            ...current,
            sequence: [
              ...current.sequence,
              clipFromLibrary(item, current.sequence.length, 0, duration),
            ],
          };
        });
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
                  row.creationId === item.id && row.sourceDurationSec == null
                    ? clampClipToComposition(
                        { ...row, sourceDurationSec: snapTenth(sourceDurationSec) },
                        projectDurationSec(current)
                      )
                    : row
                ),
              }));
            } catch {
              // Keep uncapped until the user trims against composition duration.
            }
          })();
        }
      } catch {
        // Deep-link miss stays an empty timeline.
      }
    })();
  }, [searchParams]);

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
      const save = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && !event.shiftKey;
      if (save) {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("keydown", onKey);
    };
  }, [handleSave]);

  const attachSourceDuration = useCallback(async (clipId: string, storagePath: string | null) => {
    if (!storagePath) return;
    try {
      const signed = await fetchSignedUrl({ path: storagePath });
      if (!signed.url) return;
      const sourceDurationSec = await probeVideoDurationSec(signed.url);
      if (sourceDurationSec == null) return;
      patchDoc((current) => ({
        ...current,
        sequence: current.sequence.map((clip) =>
          clip.id === clipId
            ? clampClipToComposition(
                { ...clip, sourceDurationSec: snapTenth(sourceDurationSec) },
                projectDurationSec(current)
              )
            : clip
        ),
      }));
    } catch {
      // Unknown source length stays uncapped except by composition duration.
    }
  }, [patchDoc]);

  const addClip = (item: CreationHistoryItem) => {
    if (item.mediaType !== "video" || !canDropOnEditor(item)) return;
    if (docRef.current.sequence.length >= EDITOR_MAX_SEQUENCE) return;
    const duration = projectDurationSec(docRef.current);
    const clip = clipFromLibrary(item, docRef.current.sequence.length, playhead, duration);
    patchDoc((current) => ({
      ...current,
      sequence: [...current.sequence, clip],
    }));
    void attachSourceDuration(clip.id, clip.storagePath);
  };

  const addOverlayFromItem = (kind: "image" | "video", item: CreationHistoryItem) => {
    if (!canDropOnEditor(item)) return;
    if (kind === "image" && item.mediaType !== "image") return;
    if (kind === "video" && item.mediaType !== "video") return;
    if (docRef.current.overlays.length >= EDITOR_MAX_OVERLAYS) return;
    patchDoc((current) => {
      const duration = projectDurationSec(current);
      const start = snapTenth(Math.min(playhead, Math.max(0, duration - 0.2)));
      const end = snapTenth(Math.min(duration, start + 2));
      return {
        ...current,
        overlays: [...current.overlays, mediaOverlay(kind, item, start, end, current.overlays.length)],
      };
    });
  };

  const onUpload = async (file: File) => {
    try {
      const uploaded = await uploadRefFile(file);
      const kind = uploadKindRef.current;
      if (kind === "sequence") {
        if (docRef.current.sequence.length >= EDITOR_MAX_SEQUENCE) return;
        const duration = projectDurationSec(docRef.current);
        const clip = clipFromUpload(uploaded.path, docRef.current.sequence.length, playhead, duration);
        patchDoc((current) => ({
          ...current,
          sequence: [...current.sequence, clip],
        }));
        void attachSourceDuration(clip.id, clip.storagePath);
        return;
      }
      if (docRef.current.overlays.length >= EDITOR_MAX_OVERLAYS) return;
      patchDoc((current) => {
        const duration = projectDurationSec(current);
        const start = snapTenth(Math.min(playhead, Math.max(0, duration - 0.2)));
        const end = snapTenth(Math.min(duration, start + 2));
        return {
          ...current,
          overlays: [
            ...current.overlays,
            mediaOverlay(kind, { storagePath: uploaded.path }, start, end, current.overlays.length),
          ],
        };
      });
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Upload failed.");
    }
  };

  const updateClip = (id: string, patch: Partial<EditorClip>) => {
    const next: Partial<EditorClip> = { ...patch };
    if (next.startSec != null) next.startSec = snapTenth(next.startSec);
    if (next.endSec != null) next.endSec = snapTenth(next.endSec);
    if (next.inSec != null) next.inSec = snapTenth(next.inSec);
    patchDoc((current) => ({
      ...current,
      sequence: current.sequence.map((clip) =>
        clip.id === id
          ? clampClipToComposition({ ...clip, ...next }, projectDurationSec(current))
          : clip
      ),
    }));
  };

  const updateOverlay = (id: string, patch: Partial<EditorOverlay>) => {
    const next: Partial<EditorOverlay> = { ...patch };
    if (next.startSec != null) next.startSec = snapTenth(next.startSec);
    if (next.endSec != null) next.endSec = snapTenth(next.endSec);
    patchDoc((current) => ({
      ...current,
      overlays: current.overlays.map((overlay) =>
        overlay.id === id
          ? clampOverlayToComposition({ ...overlay, ...next }, projectDurationSec(current))
          : overlay
      ),
    }));
  };

  const removeSelected = () => {
    if (!selectedId) return;
    patchDoc((current) => ({
      ...current,
      sequence: current.sequence.filter((c) => c.id !== selectedId).map((c, order) => ({ ...c, order })),
      overlays: current.overlays.filter((o) => o.id !== selectedId),
    }));
    setSelectedId(null);
  };

  const handleExport = async () => {
    if (status !== "authenticated") {
      openSignInModal();
      return;
    }
    if (exportCheck) {
      setExportError(exportCheck.message);
      return;
    }
    const attempt = begin(fingerprint);
    if (!attempt) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await fetch("/api/render-editor", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.key,
        },
        body: JSON.stringify({ title, document: doc }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (res.status === 401) {
        openSignInModal();
        attempt.settle(false);
        return;
      }
      if (!res.ok) {
        throw new Error(data.error || "Export failed.");
      }
      attempt.settle(true);
    } catch (err) {
      attempt.settle(false);
      setExportError(err instanceof Error ? err.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  };

  const pxPerSec = 64;
  const timelineWidth = Math.max(320, Math.ceil(Math.max(duration, 0.1) * pxPerSec));

  return (
    <div className="flex h-full min-h-0 flex-col bg-N50 text-text-primary">
      <EditorTopBar
        title={title}
        dirty={dirty}
        saving={saving}
        aspect={doc.aspect}
        durationSec={duration}
        exportReady={!exportCheck && duration > 0}
        exporting={exporting}
        cancelling={cancelling}
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
        onAspectChange={(aspect: EditorAspect) => patchDoc((current) => ({ ...current, aspect }))}
        onDurationChange={(next) => {
          patchDoc((current) => withProjectDuration(current, next));
          setPlayhead((head) => Math.min(head, snapTenth(Math.max(0.1, Math.min(EDITOR_MAX_DURATION_SEC, next)))));
        }}
        onExport={() => void handleExport()}
        onCancel={() => void cancel()}
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative flex min-h-0 flex-1 items-center justify-center bg-black/40 p-4">
            <div
              className="relative max-h-full max-w-full overflow-hidden rounded-lg bg-black shadow-2xl"
              style={{ aspectRatio: `${canvas.w} / ${canvas.h}`, width: "min(100%, 420px)" }}
              onClick={() => setSelectedId(null)}
            >
              {active ? (
                <SignedVideo
                  storagePath={active.clip.storagePath}
                  currentTime={active.localSec}
                  playing={playing}
                />
              ) : (
                <div className="flex h-full min-h-[240px] items-center justify-center px-6 text-center text-sm text-text-secondary">
                  {doc.sequence.length === 0
                    ? "Add a clip from My Library or upload a video to start editing."
                    : null}
                </div>
              )}
              {overlays.map((overlay) => {
                if (playhead < overlay.startSec || playhead >= overlay.endSec) return null;
                const selected = overlay.id === selectedId;
                return (
                  <div
                    key={overlay.id}
                    role="button"
                    tabIndex={0}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedId(overlay.id);
                    }}
                    onPointerDown={(event) => {
                      if (!selected) return;
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
                        updateOverlay(overlay.id, {
                          x: Math.min(1 - overlay.w, Math.max(0, orig.x + dx)),
                          y: Math.min(1 - overlay.h, Math.max(0, orig.y + dy)),
                        });
                      };
                      const up = () => {
                        window.removeEventListener("pointermove", move);
                        window.removeEventListener("pointerup", up);
                      };
                      window.addEventListener("pointermove", move);
                      window.addEventListener("pointerup", up);
                    }}
                    className={`absolute overflow-hidden ${selected ? "ring-2 ring-brand-primary" : ""}`}
                    style={{
                      left: `${overlay.x * 100}%`,
                      top: `${overlay.y * 100}%`,
                      width: `${overlay.w * 100}%`,
                      height: `${overlay.h * 100}%`,
                      zIndex: overlay.z + 1,
                    }}
                  >
                    {overlay.kind === "text" ? (
                      <div
                        className="flex h-full w-full items-center justify-center text-center font-semibold drop-shadow"
                        style={{ color: overlay.color || "#fff", fontSize: Math.max(12, (overlay.fontSize || 48) * 0.35) }}
                      >
                        {overlay.text}
                      </div>
                    ) : overlay.kind === "image" ? (
                      <SignedImage storagePath={overlay.storagePath} />
                    ) : (
                      <SignedVideo storagePath={overlay.storagePath} currentTime={0} playing={playing} />
                    )}
                    {selected ? (
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
                            updateOverlay(overlay.id, {
                              w: Math.min(1 - overlay.x, Math.max(0.05, orig.w + (ev.clientX - startX) / rect.width)),
                              h: Math.min(1 - overlay.y, Math.max(0.05, orig.h + (ev.clientY - startY) / rect.height)),
                            });
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

          <div className="shrink-0 border-t border-white/10 bg-N50">
            <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
              <button
                type="button"
                onClick={() => {
                  if (playing) setPlaying(false);
                  else if (duration > 0) setPlaying(true);
                }}
                className="rounded-lg bg-white/10 p-2 text-text-primary hover:bg-white/15"
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <span className="min-w-[5.5rem] text-xs tabular-nums text-text-secondary">
                {formatTimecode(playhead)}
                <span className="text-white/30"> / </span>
                {formatTimecode(duration)}
              </span>
              <label className="flex items-center gap-1 sm:hidden">
                <span className="text-[11px] text-text-secondary">Duration</span>
                <input
                  type="number"
                  min={0.1}
                  max={EDITOR_MAX_DURATION_SEC}
                  step={0.1}
                  value={duration}
                  onChange={(event) => {
                    const next = Number(event.target.value) || 0.1;
                    patchDoc((current) => withProjectDuration(current, next));
                    setPlayhead((head) => Math.min(head, snapTenth(Math.max(0.1, Math.min(EDITOR_MAX_DURATION_SEC, next)))));
                  }}
                  aria-label="Video duration in seconds"
                  className="h-8 w-[4.25rem] rounded-lg bg-white/10 px-2 text-xs font-semibold tabular-nums text-text-primary outline-none"
                />
                <span className="text-[11px] text-text-secondary">s</span>
              </label>
              <button
                type="button"
                onClick={() =>
                  openLibrary({
                    mediaType: "video",
                    title: "Add a clip",
                    onPick: addClip,
                  })
                }
                disabled={doc.sequence.length >= EDITOR_MAX_SEQUENCE}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/10 px-2.5 text-xs font-medium hover:bg-white/15 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
                Clip
              </button>
              <button
                type="button"
                onClick={() => {
                  uploadKindRef.current = "sequence";
                  uploadRef.current?.click();
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary hover:bg-white/10"
              >
                <Upload className="h-3.5 w-3.5" />
                Upload
              </button>
              <button
                type="button"
                onClick={() => {
                  if (doc.overlays.length >= EDITOR_MAX_OVERLAYS) return;
                  const start = snapTenth(Math.min(playhead, Math.max(0, duration - 0.2)));
                  const end = snapTenth(Math.min(duration, start + 3));
                  const overlay = textOverlay(start, Math.max(start + 0.2, end), doc.overlays.length);
                  patchDoc((current) => ({ ...current, overlays: [...current.overlays, overlay] }));
                  setSelectedId(overlay.id);
                }}
                disabled={doc.overlays.length >= EDITOR_MAX_OVERLAYS}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary hover:bg-white/10 disabled:opacity-40"
              >
                <Type className="h-3.5 w-3.5" />
                Text
              </button>
              <button
                type="button"
                onClick={() =>
                  openLibrary({
                    mediaType: "image",
                    title: "Add an image overlay",
                    onPick: (item) => addOverlayFromItem("image", item),
                  })
                }
                disabled={doc.overlays.length >= EDITOR_MAX_OVERLAYS}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary hover:bg-white/10 disabled:opacity-40"
              >
                <ImagePlus className="h-3.5 w-3.5" />
                Image
              </button>
              <button
                type="button"
                onClick={() =>
                  openLibrary({
                    mediaType: "video",
                    title: "Add a video overlay",
                    onPick: (item) => addOverlayFromItem("video", item),
                  })
                }
                disabled={doc.overlays.length >= EDITOR_MAX_OVERLAYS}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-text-secondary hover:bg-white/10 disabled:opacity-40"
              >
                <Video className="h-3.5 w-3.5" />
                PiP
              </button>
              {selectedId ? (
                <button
                  type="button"
                  onClick={removeSelected}
                  className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-error hover:bg-error/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove
                </button>
              ) : null}
              <input
                ref={uploadRef}
                type="file"
                accept={uploadKindRef.current === "image" ? "image/*" : "video/*"}
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void onUpload(file);
                }}
              />
            </div>

            <div className="overflow-x-auto px-3 py-3">
              <div
                className="relative"
                style={{ width: timelineWidth }}
                onClick={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const x = event.clientX - rect.left;
                  setPlayhead(snapTenth(Math.max(0, Math.min(Math.max(duration, 0), x / pxPerSec))));
                  setPlaying(false);
                }}
              >
                <div
                  className="pointer-events-none absolute top-0 z-20 h-full w-px bg-brand-primary"
                  style={{ left: playhead * pxPerSec }}
                />
                <div
                  className="pointer-events-none absolute top-0 z-20 -translate-x-1/2 rounded bg-brand-primary px-1 py-0.5 text-[9px] font-semibold tabular-nums text-white"
                  style={{ left: playhead * pxPerSec }}
                >
                  {formatTimecode(playhead)}
                </div>
                <div className="relative mb-2 h-5">
                  {Array.from({ length: Math.floor(timelineWidth / pxPerSec) + 1 }, (_, i) => (
                    <div
                      key={i}
                      className="absolute top-0 flex flex-col items-start"
                      style={{ left: i * pxPerSec }}
                    >
                      <span className={`w-px bg-white/25 ${i % 5 === 0 ? "h-2.5" : "h-1.5"}`} />
                      <span className="mt-0.5 text-[9px] tabular-nums text-text-secondary">{i}s</span>
                    </div>
                  ))}
                </div>
                <div className="mb-2 space-y-1">
                  {sequence.length === 0 ? (
                    <p className="text-xs text-text-secondary">Clip layers — drag to move, edges to trim</p>
                  ) : (
                    sequence.map((clip) => {
                      const clipDur = clipLayerDurationSec(clip);
                      return (
                        <TimelineLayerRow
                          key={clip.id}
                          selected={clip.id === selectedId}
                          startSec={clip.startSec}
                          endSec={clip.endSec}
                          pxPerSec={pxPerSec}
                          trackWidth={timelineWidth}
                          maxEnd={duration}
                          maxSpan={Math.min(maxClipLayerDurationSec(clip), duration)}
                          selectedClassName="bg-brand-primary/80 text-white ring-1 ring-white/40"
                          onSelect={() => setSelectedId(clip.id)}
                          onMove={(startSec, endSec) => updateClip(clip.id, { startSec, endSec })}
                          onTrimStart={(startSec) => updateClip(clip.id, { startSec })}
                          onTrimEnd={(endSec) => updateClip(clip.id, { endSec })}
                          label={
                            <>
                              Clip
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
                <div className="space-y-1">
                  {overlays.length === 0 ? (
                    <p className="text-[11px] text-text-secondary">Overlay layers — drag the edges to trim</p>
                  ) : (
                    overlays.map((overlay) => (
                      <TimelineLayerRow
                        key={overlay.id}
                        selected={overlay.id === selectedId}
                        startSec={overlay.startSec}
                        endSec={overlay.endSec}
                        pxPerSec={pxPerSec}
                        trackWidth={timelineWidth}
                        maxEnd={duration}
                        maxSpan={duration}
                        selectedClassName="bg-white/25 ring-1 ring-white/40"
                        onSelect={() => setSelectedId(overlay.id)}
                        onMove={(startSec, endSec) => updateOverlay(overlay.id, { startSec, endSec })}
                        onTrimStart={(startSec) => updateOverlay(overlay.id, { startSec })}
                        onTrimEnd={(endSec) => updateOverlay(overlay.id, { endSec })}
                        label={
                          <>
                            <span className="capitalize">{overlay.kind === "text" ? overlay.text : overlay.kind}</span>
                            <span className="ml-1 tabular-nums text-text-secondary">
                              {formatTimecode(overlay.startSec)}–{formatTimecode(overlay.endSec)}
                            </span>
                          </>
                        }
                      />
                    ))
                  )}
                </div>
              </div>
            </div>
            {exportError ? <p className="px-3 pb-2 text-xs text-error">{exportError}</p> : null}
          </div>
        </div>

        <aside className="hidden w-64 shrink-0 border-l border-white/10 p-3 lg:block">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary">Inspector</p>
          <div className="mb-3 flex gap-1 sm:hidden">
            {EDITOR_ASPECTS.map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => patchDoc((current) => ({ ...current, aspect: value }))}
                className={`rounded-md px-2 py-1 text-[11px] ${doc.aspect === value ? "bg-white/15" : "bg-white/5"}`}
              >
                {value}
              </button>
            ))}
          </div>
          {selectedClip ? (
            <div className="space-y-2 text-xs">
              <p className="font-medium">Clip layer</p>
              <label className="block text-text-secondary">
                Start
                <input
                  type="number"
                  min={0}
                  max={duration}
                  step={0.1}
                  value={snapTenth(selectedClip.startSec)}
                  onChange={(event) =>
                    updateClip(selectedClip.id, {
                      startSec: Math.max(0, Number(event.target.value) || 0),
                    })
                  }
                  className="mt-1 w-full rounded-md bg-white/10 px-2 py-1 text-text-primary"
                />
              </label>
              <label className="block text-text-secondary">
                End
                <input
                  type="number"
                  min={0.1}
                  max={duration}
                  step={0.1}
                  value={snapTenth(selectedClip.endSec)}
                  onChange={(event) =>
                    updateClip(selectedClip.id, {
                      endSec: Number(event.target.value) || 0,
                    })
                  }
                  className="mt-1 w-full rounded-md bg-white/10 px-2 py-1 text-text-primary"
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
                  className="mt-1 w-full rounded-md bg-white/10 px-2 py-1 text-text-primary"
                />
              </label>
              {selectedClip.sourceDurationSec != null ? (
                <p className="text-text-secondary">
                  Source {formatTimecode(selectedClip.sourceDurationSec)} · layer max{" "}
                  {formatTimecode(maxClipLayerDurationSec(selectedClip))}
                </p>
              ) : null}
            </div>
          ) : selectedOverlay ? (
            <div className="space-y-2 text-xs">
              <p className="font-medium capitalize">{selectedOverlay.kind} overlay</p>
              {selectedOverlay.kind === "text" ? (
                <>
                  <label className="block text-text-secondary">
                    Text
                    <input
                      value={selectedOverlay.text ?? ""}
                      onChange={(event) => updateOverlay(selectedOverlay.id, { text: event.target.value.slice(0, 200) })}
                      className="mt-1 w-full rounded-md bg-white/10 px-2 py-1 text-text-primary"
                    />
                  </label>
                  <label className="block text-text-secondary">
                    Color
                    <input
                      type="color"
                      value={selectedOverlay.color || "#ffffff"}
                      onChange={(event) => updateOverlay(selectedOverlay.id, { color: event.target.value })}
                      className="mt-1 h-8 w-full bg-transparent"
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
                      className="mt-1 w-full rounded-md bg-white/10 px-2 py-1 text-text-primary"
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
                  className="mt-1 w-full rounded-md bg-white/10 px-2 py-1 text-text-primary"
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
                  className="mt-1 w-full rounded-md bg-white/10 px-2 py-1 text-text-primary"
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
                  className="mt-1 w-full rounded-md bg-white/10 px-2 py-1 text-text-primary"
                />
              </label>
            </div>
          ) : (
            <p className="text-xs text-text-secondary">
              Set Duration in the top bar. Select a clip or overlay to place it on the timeline.
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
    </div>
  );
}
