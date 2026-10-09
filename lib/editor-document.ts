/**
 * Persistable Editor timeline. Clips and overlays are layers on a composition
 * whose duration is derived from the latest layer end (projectDurationSec).
 * Media is referenced by creationId or storagePath — never blob/signed URLs —
 * so a reload can re-sign. Device files are `localMediaId` only (a key into the
 * browser's IndexedDB copy) until export uploads them.
 *
 * Pure — runnable as `npx tsx lib/editor-document.ts`.
 */

import { isVideosTempRefPath } from "./storage-buckets";

export const EDITOR_DOCUMENT_VERSION = 1;
export const EDITOR_TITLE_MAX = 80;
export const EDITOR_MAX_SEQUENCE = 8;
export const EDITOR_MAX_OVERLAYS = 8;
export const EDITOR_MAX_DURATION_SEC = 60;
export const DEFAULT_EDITOR_DURATION_SEC = 8;
export const EDITOR_DOCUMENT_JSON_MAX = 200_000;
export const DEFAULT_EDITOR_TITLE = "Untitled edit";

export const EDITOR_ASPECTS = ["9:16", "1:1", "16:9"] as const;
export type EditorAspect = (typeof EDITOR_ASPECTS)[number];

export const EDITOR_CANVAS: Record<EditorAspect, { w: number; h: number }> = {
  "9:16": { w: 720, h: 1280 },
  "1:1": { w: 1080, h: 1080 },
  "16:9": { w: 1280, h: 720 },
};

export const EDITOR_TEXT_MIN_FONT_SIZE = 12;
export const EDITOR_TEXT_MAX_FONT_SIZE = 200;
export const EDITOR_TEXT_DEFAULT_FONT_SIZE = 48;

export type TextOverlayLayout = {
  fontSize: number;
  box: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  alignment: {
    horizontal: "center";
    vertical: "center";
  };
  lineHeight: number;
  shadow: {
    color: string;
    colorCss: string;
    x: number;
    y: number;
  };
};

export function textOverlayLayout(
  overlay: Pick<EditorOverlay, "x" | "y" | "w" | "h" | "fontSize">,
  canvas: { w: number; h: number },
  scale = 1
): TextOverlayLayout {
  const fontSize = Math.max(
    EDITOR_TEXT_MIN_FONT_SIZE,
    Math.min(EDITOR_TEXT_MAX_FONT_SIZE, Math.round(overlay.fontSize ?? EDITOR_TEXT_DEFAULT_FONT_SIZE))
  ) * scale;
  const x = Math.round(overlay.x * canvas.w);
  const y = Math.round(overlay.y * canvas.h);
  const w = Math.max(2, Math.round(overlay.w * canvas.w));
  const h = Math.max(2, Math.round(overlay.h * canvas.h));

  return {
    fontSize,
    box: { x, y, w, h },
    alignment: {
      horizontal: "center",
      vertical: "center",
    },
    // Poppins' font-defined line height (hhea ascent - descent + lineGap = 1.5em),
    // which FFmpeg 7 drawtext uses as its line pitch. Keeps multi-line text aligned.
    lineHeight: 1.5,
    shadow: {
      color: "black@0.6",
      colorCss: "rgba(0, 0, 0, 0.6)",
      x: Math.max(1, Math.round(2 * scale)),
      y: Math.max(1, Math.round(2 * scale)),
    },
  };
}

export type EditorClip = {
  id: string;
  name?: string | null;
  creationId: string | null;
  storagePath: string | null;
  /** Device file kept in this browser (lib/editor-local-media.ts); uploaded only on export. */
  localMediaId?: string | null;
  /** Timeline placement. */
  startSec: number;
  endSec: number;
  /** Source in-point. Source out is inSec + (endSec - startSec). */
  inSec: number;
  /** Known source length; layer span cannot exceed sourceDuration - inSec. */
  sourceDurationSec: number | null;
  order: number;
  locked: boolean;
  hidden: boolean;
  muted?: boolean;
};

export type EditorOverlayKind = "text" | "image" | "video";

export type EditorOverlay = {
  id: string;
  name?: string | null;
  kind: EditorOverlayKind;
  startSec: number;
  endSec: number;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  text: string | null;
  fontSize: number | null;
  color: string | null;
  creationId: string | null;
  storagePath: string | null;
  /** Device file kept in this browser (lib/editor-local-media.ts); uploaded only on export. */
  localMediaId?: string | null;
  /** Video overlays only: known source length; layer span cannot exceed it. */
  sourceDurationSec?: number | null;
  /** Video overlays only: source in-point (default 0). */
  inSec?: number;
  locked: boolean;
  hidden: boolean;
  muted?: boolean;
};

/** Duration is not stored; it is derived from layers by projectDurationSec. */
export type EditorDocument = {
  v: typeof EDITOR_DOCUMENT_VERSION;
  aspect: EditorAspect;
  sequence: EditorClip[];
  overlays: EditorOverlay[];
};

export type EditorSummary = {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  clipCount: number;
};

const ID_MAX = 64;
const PATH_MAX = 512;
const TEXT_MAX = 200;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const LAYER_NAME_MAX = 60;

export function normalizeLayerName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, LAYER_NAME_MAX);
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveLayerLabel(
  layer: EditorClip | EditorOverlay,
  fallbackIndex?: number
): string {
  if (layer.name && layer.name.trim().length > 0) {
    return layer.name.trim();
  }
  if ("kind" in layer) {
    if (layer.kind === "text") {
      return layer.text?.trim() || "Text";
    }
    if (layer.kind === "image") {
      return typeof fallbackIndex === "number" ? `Image overlay ${fallbackIndex + 1}` : "Image overlay";
    }
    return typeof fallbackIndex === "number" ? `Video overlay ${fallbackIndex + 1}` : "Video overlay";
  }
  const index = typeof fallbackIndex === "number" ? fallbackIndex + 1 : layer.order + 1;
  return `Clip ${index}`;
}

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asTrimmed(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function snapTenth(n: number): number {
  return Math.round(clamp(n, 0, EDITOR_MAX_DURATION_SEC) * 10) / 10;
}

function asId(value: unknown): string | null {
  const id = asTrimmed(value, ID_MAX);
  return id.length > 0 ? id : null;
}

function asPath(value: unknown): string | null {
  const path = asTrimmed(value, PATH_MAX);
  return path.length > 0 ? path : null;
}

const LOCAL_MEDIA_ID_RE = /^[A-Za-z0-9-]{1,64}$/;

function asLocalMediaId(value: unknown): string | null {
  return typeof value === "string" && LOCAL_MEDIA_ID_RE.test(value) ? value : null;
}

function asAspect(value: unknown): EditorAspect {
  return EDITOR_ASPECTS.includes(value as EditorAspect) ? (value as EditorAspect) : "9:16";
}

export function emptyEditorDocument(): EditorDocument {
  return {
    v: EDITOR_DOCUMENT_VERSION,
    aspect: "9:16",
    sequence: [],
    overlays: [],
  };
}

export function normalizeEditorTitle(raw: string): string {
  const title = raw.trim().slice(0, EDITOR_TITLE_MAX);
  return title || DEFAULT_EDITOR_TITLE;
}

export function clipLayerDurationSec(clip: EditorClip): number {
  return Math.max(0, snapTenth(clip.endSec) - snapTenth(clip.startSec));
}

/** @deprecated use clipLayerDurationSec — kept so existing imports keep working. */
export function clipDurationSec(clip: EditorClip): number {
  return clipLayerDurationSec(clip);
}

export function clipSourceOutSec(clip: EditorClip): number {
  return snapTenth(clip.inSec + clipLayerDurationSec(clip));
}

export function maxClipLayerDurationSec(clip: EditorClip): number {
  if (clip.sourceDurationSec != null && clip.sourceDurationSec > 0) {
    return Math.max(0.1, snapTenth(clip.sourceDurationSec - clip.inSec));
  }
  return EDITOR_MAX_DURATION_SEC;
}

export function maxOverlayLayerDurationSec(overlay: EditorOverlay): number {
  if (overlay.kind === "video" && overlay.sourceDurationSec != null && overlay.sourceDurationSec > 0) {
    return Math.max(0.1, snapTenth(overlay.sourceDurationSec - (overlay.inSec ?? 0)));
  }
  return EDITOR_MAX_DURATION_SEC;
}

/** Latest layer end, capped at EDITOR_MAX_DURATION_SEC; the default length while empty. */
export function projectDurationSec(doc: EditorDocument): number {
  const ends = [...doc.sequence, ...doc.overlays].map((layer) => layer.endSec);
  if (ends.length === 0) return DEFAULT_EDITOR_DURATION_SEC;
  return snapTenth(clamp(Math.max(...ends), 0.1, EDITOR_MAX_DURATION_SEC));
}

/** Composition length — clips no longer concatenate to define duration. */
export function sequenceDurationSec(doc: EditorDocument): number {
  return projectDurationSec(doc);
}

export function sortedSequence(doc: EditorDocument): EditorClip[] {
  return [...doc.sequence].sort(
    (a, b) => a.order - b.order || a.startSec - b.startSec || a.id.localeCompare(b.id)
  );
}

export function sortedOverlays(doc: EditorDocument): EditorOverlay[] {
  return [...doc.overlays].sort((a, b) => a.z - b.z || a.id.localeCompare(b.id));
}

export type ClipAtPlayhead = { clip: EditorClip; localSec: number; timelineStart: number };

/** Every clip covering the playhead (end-exclusive), bottom to top. */
export function clipsAtPlayhead(doc: EditorDocument, playheadSec: number): ClipAtPlayhead[] {
  return doc.sequence
    .filter((clip) => playheadSec >= clip.startSec && playheadSec < clip.endSec)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map((clip) => ({
      clip,
      localSec: clip.inSec + (playheadSec - clip.startSec),
      timelineStart: clip.startSec,
    }));
}

export function clipAtPlayhead(doc: EditorDocument, playheadSec: number): ClipAtPlayhead | null {
  const covering = clipsAtPlayhead(doc, playheadSec);
  return covering[covering.length - 1] ?? null;
}

/** Clamps a clip to the composition cap and its source length. */
export function clampClipToComposition(clip: EditorClip): EditorClip {
  const duration = EDITOR_MAX_DURATION_SEC;
  const maxSpan = Math.min(maxClipLayerDurationSec(clip), duration);
  let startSec = snapTenth(clamp(clip.startSec, 0, Math.max(0, duration - 0.1)));
  let endSec = snapTenth(clamp(clip.endSec, startSec + 0.1, duration));
  if (endSec - startSec > maxSpan) {
    endSec = snapTenth(startSec + maxSpan);
  }
  if (endSec > duration) {
    endSec = duration;
    startSec = snapTenth(Math.max(0, endSec - maxSpan));
  }
  if (endSec <= startSec) {
    startSec = 0;
    endSec = snapTenth(Math.min(duration, Math.max(0.1, maxSpan)));
  }
  let inSec = snapTenth(Math.max(0, clip.inSec));
  if (clip.sourceDurationSec != null) {
    const maxIn = Math.max(0, snapTenth(clip.sourceDurationSec - (endSec - startSec)));
    inSec = Math.min(inSec, maxIn);
  }
  return { ...clip, startSec, endSec, inSec };
}

export const CLIP_MIN_SPAN_SEC = 0.2;

export function canSplitClip(clip: EditorClip, playheadSec: number): boolean {
  if (clip.locked) return false;
  const p = snapTenth(playheadSec);
  const leftSpan = snapTenth(p - clip.startSec);
  const rightSpan = snapTenth(clip.endSec - p);
  return leftSpan >= CLIP_MIN_SPAN_SEC && rightSpan >= CLIP_MIN_SPAN_SEC;
}

export function splitEditorClip(
  doc: EditorDocument,
  clipId: string,
  playheadSec: number,
  newClipId?: string
): { doc: EditorDocument; rightClipId: string } | null {
  const sorted = sortedSequence(doc);
  const targetIndex = sorted.findIndex((c) => c.id === clipId);
  if (targetIndex === -1) return null;
  const target = sorted[targetIndex];
  if (!canSplitClip(target, playheadSec)) return null;

  const p = snapTenth(playheadSec);
  const leftClip: EditorClip = clampClipToComposition(
    {
      ...target,
      endSec: p,
    }
  );

  const delta = snapTenth(p - target.startSec);
  const rightId = newClipId ?? `clip-${crypto.randomUUID().slice(0, 8)}`;
  const rightClip: EditorClip = clampClipToComposition(
    {
      ...target,
      id: rightId,
      startSec: p,
      endSec: target.endSec,
      inSec: snapTenth(target.inSec + delta),
    }
  );

  const newSequence: EditorClip[] = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i === targetIndex) {
      newSequence.push(leftClip, rightClip);
    } else {
      newSequence.push(sorted[i]);
    }
  }

  return {
    doc: {
      ...doc,
      sequence: newSequence.map((c, i) => ({ ...c, order: i })),
    },
    rightClipId: rightId,
  };
}

export function canTrimClipStart(clip: EditorClip, playheadSec: number): boolean {
  if (clip.locked) return false;
  const p = snapTenth(playheadSec);
  return p > clip.startSec && snapTenth(clip.endSec - p) >= CLIP_MIN_SPAN_SEC;
}

export function trimClipStartToPlayhead(
  doc: EditorDocument,
  clipId: string,
  playheadSec: number
): EditorDocument | null {
  const clip = doc.sequence.find((c) => c.id === clipId);
  if (!clip || !canTrimClipStart(clip, playheadSec)) return null;
  const p = snapTenth(playheadSec);
  const delta = snapTenth(p - clip.startSec);
  return {
    ...doc,
    sequence: doc.sequence.map((c) =>
      c.id === clipId
        ? clampClipToComposition(
            {
              ...c,
              startSec: p,
              inSec: snapTenth(c.inSec + delta),
            }
          )
        : c
    ),
  };
}

export function canTrimClipEnd(clip: EditorClip, playheadSec: number): boolean {
  if (clip.locked) return false;
  const p = snapTenth(playheadSec);
  return p < clip.endSec && snapTenth(p - clip.startSec) >= CLIP_MIN_SPAN_SEC;
}

export function trimClipEndToPlayhead(
  doc: EditorDocument,
  clipId: string,
  playheadSec: number
): EditorDocument | null {
  const clip = doc.sequence.find((c) => c.id === clipId);
  if (!clip || !canTrimClipEnd(clip, playheadSec)) return null;
  const p = snapTenth(playheadSec);
  return {
    ...doc,
    sequence: doc.sequence.map((c) =>
      c.id === clipId
        ? clampClipToComposition(
            {
              ...c,
              endSec: p,
            }
          )
        : c
    ),
  };
}

/**
 * Left-edge drag: start and source in-point move together so the end and source
 * out-point stay fixed. `inSec` is undefined for layers with no source (image/text).
 */
export function trimStartBy(
  startSec: number,
  endSec: number,
  inSec: number | undefined,
  deltaSec: number
): { startSec: number; inSec?: number } {
  const lowest = inSec === undefined ? 0 : Math.max(0, snapTenth(startSec - inSec));
  const next = snapTenth(clamp(startSec + deltaSec, lowest, Math.max(lowest, endSec - CLIP_MIN_SPAN_SEC)));
  return { startSec: next, inSec: inSec === undefined ? undefined : snapTenth(inSec + next - startSec) };
}

/** Clamps an overlay to the composition cap and, for video, its source length. */
export function clampOverlayToComposition(overlay: EditorOverlay): EditorOverlay {
  const duration = EDITOR_MAX_DURATION_SEC;
  const maxSpan = maxOverlayLayerDurationSec(overlay);
  let startSec = snapTenth(clamp(overlay.startSec, 0, Math.max(0, duration - 0.1)));
  let endSec = snapTenth(clamp(overlay.endSec, startSec + 0.1, Math.min(duration, startSec + maxSpan)));
  if (endSec <= startSec) {
    startSec = 0;
    endSec = snapTenth(Math.min(duration, 0.1));
  }
  return { ...overlay, startSec, endSec };
}

/**
 * Records a probed source length. With `fillSpan` (the layer still has its
 * placeholder span) the layer grows to the remaining source, fit to the cap;
 * otherwise a user edit made before the probe returned is kept, only capped.
 */
export function withProbedClipSource(clip: EditorClip, sourceSec: number, fillSpan = true): EditorClip {
  if (clip.sourceDurationSec != null) return clip;
  const sourceDurationSec = snapTenth(sourceSec);
  return clampClipToComposition({
    ...clip,
    sourceDurationSec,
    endSec: fillSpan ? clip.startSec + Math.max(0.1, sourceDurationSec - clip.inSec) : clip.endSec,
  });
}

export function withProbedOverlaySource(overlay: EditorOverlay, sourceSec: number, fillSpan = true): EditorOverlay {
  if (overlay.kind !== "video" || overlay.sourceDurationSec != null) return overlay;
  const sourceDurationSec = snapTenth(sourceSec);
  return clampOverlayToComposition({
    ...overlay,
    sourceDurationSec,
    endSec: fillSpan ? overlay.startSec + sourceDurationSec : overlay.endSec,
  });
}

/** A layer still at the span it was created with: a 3 s clip from the source start, or a 2 s video overlay. */
export function isPlaceholderSpan(layer: EditorClip | EditorOverlay): boolean {
  const span = snapTenth(layer.endSec - layer.startSec);
  return "kind" in layer ? span === 2 : layer.inSec === 0 && span === 3;
}

/**
 * Applies a probed source length to the clip or video overlay with `layerId`
 * (ids are unique across both). Returns `doc` itself when nothing changed.
 */
export function withProbedLayerSource(
  doc: EditorDocument,
  layerId: string,
  sourceSec: number,
  fillSpan: (layer: EditorClip | EditorOverlay) => boolean
): EditorDocument {
  const sequence = doc.sequence.map((c) => (c.id === layerId ? withProbedClipSource(c, sourceSec, fillSpan(c)) : c));
  const overlays = doc.overlays.map((o) =>
    o.id === layerId ? withProbedOverlaySource(o, sourceSec, fillSpan(o)) : o
  );
  const changed = sequence.some((c, i) => c !== doc.sequence[i]) || overlays.some((o, i) => o !== doc.overlays[i]);
  return changed ? { ...doc, sequence, overlays } : doc;
}

function reprojectOverlayToAspect(
  overlay: EditorOverlay,
  oldCanvas: { w: number; h: number },
  newCanvas: { w: number; h: number }
): EditorOverlay {
  const pixelX = overlay.x * oldCanvas.w;
  const pixelY = overlay.y * oldCanvas.h;
  const pixelW = overlay.w * oldCanvas.w;
  const pixelH = overlay.h * oldCanvas.h;

  const w = clamp(pixelW / newCanvas.w, 0, 1);
  const h = clamp(pixelH / newCanvas.h, 0, 1);
  const x = clamp(pixelX / newCanvas.w, 0, 1 - w);
  const y = clamp(pixelY / newCanvas.h, 0, 1 - h);

  return { ...overlay, x, y, w, h };
}

export function withProjectAspect(doc: EditorDocument, aspect: EditorAspect): EditorDocument {
  if (aspect === doc.aspect) return doc;
  const oldCanvas = EDITOR_CANVAS[doc.aspect];
  const newCanvas = EDITOR_CANVAS[aspect];
  return {
    ...doc,
    aspect,
    overlays: doc.overlays.map((overlay) => reprojectOverlayToAspect(overlay, oldCanvas, newCanvas)),
  };
}

function parseClip(raw: unknown, index: number): (EditorClip & { packed?: boolean }) | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = asId(o.id);
  if (!id) return null;
  const inSec = snapTenth(clamp(asFiniteNumber(o.inSec, 0), 0, EDITOR_MAX_DURATION_SEC));
  const legacyOut = snapTenth(
    clamp(asFiniteNumber(o.outSec, inSec + 3), inSec + 0.1, inSec + EDITOR_MAX_DURATION_SEC)
  );
  const packed = typeof o.startSec !== "number";
  const startSec = packed
    ? 0
    : snapTenth(clamp(asFiniteNumber(o.startSec, 0), 0, EDITOR_MAX_DURATION_SEC));
  const span = packed
    ? Math.max(0.1, legacyOut - inSec)
    : Math.max(0.1, asFiniteNumber(o.endSec, startSec + (legacyOut - inSec)) - startSec);
  const endSec = snapTenth(startSec + span);
  if (endSec <= startSec) return null;
  const sourceRaw = o.sourceDurationSec;
  const sourceDurationSec =
    typeof sourceRaw === "number" && Number.isFinite(sourceRaw) && sourceRaw > 0
      ? snapTenth(sourceRaw)
      : null;
  return {
    id,
    name: normalizeLayerName(o.name),
    creationId: asId(o.creationId),
    storagePath: asPath(o.storagePath),
    localMediaId: asLocalMediaId(o.localMediaId),
    startSec,
    endSec,
    inSec,
    sourceDurationSec,
    order: Number.isFinite(asFiniteNumber(o.order, index)) ? asFiniteNumber(o.order, index) : index,
    locked: Boolean(o.locked),
    hidden: Boolean(o.hidden),
    muted: Boolean(o.muted),
    packed,
  };
}

function parseOverlay(raw: unknown, index: number): EditorOverlay | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = asId(o.id);
  if (!id) return null;
  const kind = o.kind;
  if (kind !== "text" && kind !== "image" && kind !== "video") return null;
  const startSec = snapTenth(clamp(asFiniteNumber(o.startSec, 0), 0, EDITOR_MAX_DURATION_SEC));
  const endSec = snapTenth(
    clamp(asFiniteNumber(o.endSec, startSec + 2), startSec + 0.1, EDITOR_MAX_DURATION_SEC)
  );
  if (endSec <= startSec) return null;
  const colorRaw = asTrimmed(o.color, 7);
  const sourceRaw = o.sourceDurationSec;
  const sourceDurationSec =
    typeof sourceRaw === "number" && Number.isFinite(sourceRaw) && sourceRaw > 0 ? snapTenth(sourceRaw) : null;
  return {
    id,
    name: normalizeLayerName(o.name),
    kind,
    startSec,
    endSec,
    x: clamp(asFiniteNumber(o.x, 0.1), 0, 1),
    y: clamp(asFiniteNumber(o.y, 0.1), 0, 1),
    w: clamp(asFiniteNumber(o.w, 0.3), 0.02, 1),
    h: clamp(asFiniteNumber(o.h, 0.2), 0.02, 1),
    z: Math.round(clamp(asFiniteNumber(o.z, index), 0, 32)),
    text: kind === "text" ? asTrimmed(o.text, TEXT_MAX) || "Text" : null,
    fontSize: kind === "text" ? clamp(asFiniteNumber(o.fontSize, 48), 12, 200) : null,
    color: kind === "text" && COLOR_RE.test(colorRaw) ? colorRaw : kind === "text" ? "#FFFFFF" : null,
    creationId: kind === "text" ? null : asId(o.creationId),
    storagePath: kind === "text" ? null : asPath(o.storagePath),
    localMediaId: kind === "text" ? null : asLocalMediaId(o.localMediaId),
    sourceDurationSec: kind === "video" ? sourceDurationSec : undefined,
    inSec: kind === "video" ? snapTenth(clamp(asFiniteNumber(o.inSec, 0), 0, EDITOR_MAX_DURATION_SEC)) : undefined,
    locked: Boolean(o.locked),
    hidden: Boolean(o.hidden),
    muted: kind === "video" ? Boolean(o.muted) : undefined,
  };
}

export function parseEditorDocument(raw: unknown): EditorDocument | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const sequenceRaw = Array.isArray(o.sequence) ? o.sequence : [];
  const overlaysRaw = Array.isArray(o.overlays) ? o.overlays : [];
  const parsedClips: (EditorClip & { packed?: boolean })[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < sequenceRaw.length && parsedClips.length < EDITOR_MAX_SEQUENCE; i++) {
    const clip = parseClip(sequenceRaw[i], i);
    if (!clip || seen.has(clip.id)) continue;
    seen.add(clip.id);
    parsedClips.push(clip);
  }
  const needPack = parsedClips.some((clip) => clip.packed);
  if (needPack) {
    parsedClips.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    let cursor = 0;
    for (const clip of parsedClips) {
      const span = clipLayerDurationSec(clip);
      clip.startSec = snapTenth(cursor);
      clip.endSec = snapTenth(cursor + span);
      cursor = clip.endSec;
    }
  }
  const overlays: EditorOverlay[] = [];
  for (let i = 0; i < overlaysRaw.length && overlays.length < EDITOR_MAX_OVERLAYS; i++) {
    const overlay = parseOverlay(overlaysRaw[i], i);
    if (!overlay || seen.has(overlay.id)) continue;
    seen.add(overlay.id);
    overlays.push(overlay);
  }
  // Legacy `durationSec` is ignored: duration is derived, and layers were already clamped to it.
  const sequence = parsedClips.map((clip) =>
    clampClipToComposition(
      {
        id: clip.id,
        name: clip.name ?? null,
        creationId: clip.creationId,
        storagePath: clip.storagePath,
        localMediaId: clip.localMediaId,
        startSec: clip.startSec,
        endSec: clip.endSec,
        inSec: clip.inSec,
        sourceDurationSec: clip.sourceDurationSec,
        order: clip.order,
        locked: clip.locked,
        hidden: clip.hidden,
        muted: clip.muted,
      })
  );
  return {
    v: EDITOR_DOCUMENT_VERSION,
    aspect: asAspect(o.aspect),
    sequence,
    overlays: overlays.map((overlay) => clampOverlayToComposition(overlay)),
  };
}

export function editorDocumentJsonTooLarge(doc: EditorDocument): boolean {
  return JSON.stringify(doc).length > EDITOR_DOCUMENT_JSON_MAX;
}

/** A device file that lives only in this browser until export. */
export function isLocalOnlyLayer(layer: EditorClip | EditorOverlay): boolean {
  return Boolean(layer.localMediaId && !layer.creationId && !layer.storagePath);
}

/** `allowLocal`: count browser-only device media as a source (client pre-export check). */
export function clipHasSource(clip: EditorClip, allowLocal = false): boolean {
  return Boolean(clip.creationId || clip.storagePath || (allowLocal && clip.localMediaId));
}

export function overlayHasSource(overlay: EditorOverlay, allowLocal = false): boolean {
  if (overlay.kind === "text") return Boolean(overlay.text?.trim());
  return Boolean(overlay.creationId || overlay.storagePath || (allowLocal && overlay.localMediaId));
}

export type EditorExportError = { code: string; message: string };

export function validateEditorExport(
  doc: EditorDocument,
  opts?: { allowLocal?: boolean }
): EditorExportError | null {
  const allowLocal = Boolean(opts?.allowLocal);
  if (doc.sequence.length === 0) {
    return { code: "EMPTY_SEQUENCE", message: "Add at least one clip before exporting." };
  }
  if (doc.sequence.length > EDITOR_MAX_SEQUENCE) {
    return { code: "SEQUENCE_CAP", message: `Sequence is limited to ${EDITOR_MAX_SEQUENCE} clips.` };
  }
  if (doc.overlays.length > EDITOR_MAX_OVERLAYS) {
    return { code: "OVERLAY_CAP", message: `Overlays are limited to ${EDITOR_MAX_OVERLAYS}.` };
  }
  const duration = projectDurationSec(doc);
  if (duration <= 0) {
    return { code: "EMPTY_DURATION", message: "Set a video duration before exporting." };
  }
  if (duration > EDITOR_MAX_DURATION_SEC) {
    return {
      code: "DURATION_CAP",
      message: `Timeline is limited to ${EDITOR_MAX_DURATION_SEC} seconds.`,
    };
  }
  for (const clip of doc.sequence) {
    if (!clipHasSource(clip, allowLocal)) {
      return { code: "CLIP_SOURCE", message: "Every sequence clip needs a library item or upload." };
    }
    if (clip.endSec - clip.startSec > maxClipLayerDurationSec(clip) + 0.05) {
      return { code: "CLIP_SOURCE_LENGTH", message: "A clip layer is longer than its source video." };
    }
  }
  for (const overlay of doc.overlays) {
    if (!overlayHasSource(overlay, allowLocal)) {
      return { code: "OVERLAY_SOURCE", message: "Every overlay needs text or a media source." };
    }
  }
  return null;
}

export function collectEditorMediaRefs(doc: EditorDocument): {
  creationIds: string[];
  storagePaths: string[];
} {
  const creationIds: string[] = [];
  const storagePaths: string[] = [];
  const seenC = new Set<string>();
  const seenP = new Set<string>();
  const add = (creationId: string | null, storagePath: string | null) => {
    if (creationId && !seenC.has(creationId)) {
      seenC.add(creationId);
      creationIds.push(creationId);
    }
    if (storagePath && !seenP.has(storagePath)) {
      seenP.add(storagePath);
      storagePaths.push(storagePath);
    }
  };
  for (const clip of doc.sequence) add(clip.creationId, clip.storagePath);
  for (const overlay of doc.overlays) add(overlay.creationId, overlay.storagePath);
  return { creationIds, storagePaths };
}

export type EditorExportUpload = { localMediaId: string; storagePath: string };

/**
 * Validates the device files an export uploaded. A path is accepted only when it
 * sits directly under the caller's own temp refs prefix (`ownerPrefix`) and a
 * layer with the same `localMediaId` references it. Null = reject the request.
 * Only accepted paths may be deleted after the export.
 */
export function acceptEditorExportUploads(
  raw: unknown,
  doc: EditorDocument,
  ownerPrefix: string
): EditorExportUpload[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > EDITOR_MAX_SEQUENCE + EDITOR_MAX_OVERLAYS) return null;
  const layers = [...doc.sequence, ...doc.overlays];
  const accepted: EditorExportUpload[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const { localMediaId, storagePath } = entry as Record<string, unknown>;
    if (typeof localMediaId !== "string" || typeof storagePath !== "string") return null;
    const filename = storagePath.startsWith(ownerPrefix) ? storagePath.slice(ownerPrefix.length) : "";
    if (!filename || filename.includes("/") || !isVideosTempRefPath(storagePath)) return null;
    const referenced = layers.some(
      (layer) => layer.localMediaId === localMediaId && layer.storagePath === storagePath
    );
    if (!referenced) return null;
    if (seen.has(storagePath)) continue;
    seen.add(storagePath);
    accepted.push({ localMediaId, storagePath });
  }
  return accepted;
}

/**
 * The document as the export request hash sees it: layers whose storagePath is a
 * fresh export upload hash their localMediaId instead, so a retry that re-uploads
 * the same device files reuses its idempotency key.
 */
export function editorExportHashDocument(
  doc: EditorDocument,
  uploads: EditorExportUpload[]
): EditorDocument {
  const uploaded = new Set(uploads.map((u) => u.storagePath));
  const swap = <T extends EditorClip | EditorOverlay>(layer: T): T =>
    layer.storagePath && uploaded.has(layer.storagePath) && layer.localMediaId
      ? { ...layer, storagePath: `local:${layer.localMediaId}` }
      : layer;
  return { ...doc, sequence: doc.sequence.map(swap), overlays: doc.overlays.map(swap) };
}

export const EDITOR_MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25 MB, editor-only client limit
export const EDITOR_MAX_UPLOAD_MB = EDITOR_MAX_UPLOAD_BYTES / (1024 * 1024);

export const EDITOR_ACCEPTED_VIDEO_MIME_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
] as const;

export const EDITOR_ACCEPTED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export const EDITOR_ACCEPTED_UPLOAD_MIME_TYPES = new Set<string>([
  ...EDITOR_ACCEPTED_VIDEO_MIME_TYPES,
  ...EDITOR_ACCEPTED_IMAGE_MIME_TYPES,
]);

export function validateEditorUploadFile(
  file: { size: number; type: string; name: string },
  expectedKind?: "sequence" | "image" | "video"
): { ok: true } | { ok: false; error: string } {
  if (file.size > EDITOR_MAX_UPLOAD_BYTES) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `File is too large (${sizeMB} MB). The maximum size is ${EDITOR_MAX_UPLOAD_MB} MB.`,
    };
  }

  if (!file.type || !EDITOR_ACCEPTED_UPLOAD_MIME_TYPES.has(file.type)) {
    return {
      ok: false,
      error: `File type "${file.type || file.name}" isn't supported. Use MP4, MOV, WebM, JPEG, PNG, or WebP.`,
    };
  }

  if (expectedKind === "image" && !file.type.startsWith("image/")) {
    return {
      ok: false,
      error: "Only image files (JPEG, PNG, WebP) can be used as image overlays.",
    };
  }

  if ((expectedKind === "sequence" || expectedKind === "video") && !file.type.startsWith("video/")) {
    return {
      ok: false,
      error: "Only video files (MP4, MOV, WebM) are allowed.",
    };
  }

  return { ok: true };
}


function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`editor-document self-check: ${msg}`);
}

/** Reorders `list` by moving `sourceId` next to `targetId`; null when nothing moves. */
export function reorderById<T extends { id: string }>(
  list: T[],
  sourceId: string,
  targetId: string
): T[] | null {
  if (sourceId === targetId) return null;
  const items = [...list];
  const from = items.findIndex((item) => item.id === sourceId);
  const to = items.findIndex((item) => item.id === targetId);
  if (from === -1 || to === -1) return null;
  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);
  return items;
}

export function editorDocumentSelfCheck(): void {
  const empty = emptyEditorDocument();
  assert(empty.sequence.length === 0 && empty.aspect === "9:16", "empty document defaults");
  assert(projectDurationSec(empty) === DEFAULT_EDITOR_DURATION_SEC, "empty composition is 8s");
  assert(parseEditorDocument(null) === null, "null is not a document");

  const parsed = parseEditorDocument({
    v: 1,
    aspect: "16:9",
    sequence: [
      { id: "a", creationId: "c1", inSec: 1, outSec: 4, order: 1 },
      { id: "b", storagePath: "u/videos/temp/x.mp4", inSec: 0, outSec: 2, order: 0 },
    ],
    overlays: [
      {
        id: "t1",
        kind: "text",
        startSec: 0,
        endSec: 3,
        x: 0.1,
        y: 0.8,
        w: 0.8,
        h: 0.1,
        z: 2,
        text: "Hello",
        fontSize: 40,
        color: "#FF0000",
      },
    ],
  });
  assert(parsed?.aspect === "16:9", "aspect parsed");
  assert(parsed?.sequence.length === 2, "two clips");
  assert(sortedSequence(parsed!).map((c) => c.id).join(",") === "b,a", "legacy clips pack in order");
  assert(parsed!.sequence.find((c) => c.id === "b")?.startSec === 0, "first packed clip starts at 0");
  assert(parsed!.sequence.find((c) => c.id === "a")?.startSec === 2, "second packed clip follows");
  assert(projectDurationSec(parsed!) === 5, "duration is the latest packed clip end");
  assert(validateEditorExport(parsed!) === null, "valid export");
  assert(clipAtPlayhead(parsed!, 0)?.clip.id === "b", "playhead 0 is first packed clip");
  assert(clipAtPlayhead(parsed!, 2.5)?.clip.id === "a", "playhead crosses into second clip");
  assert(clipAtPlayhead(parsed!, 7.5) === null, "gap after clips is empty");

  const stacked = parseEditorDocument({
    durationSec: 10,
    sequence: [
      { id: "top", startSec: 1, endSec: 4, inSec: 0, outSec: 3, order: 1 },
      { id: "low", startSec: 0, endSec: 3, inSec: 2, outSec: 5, order: 0 },
    ],
  })!;
  const at2 = clipsAtPlayhead(stacked, 2);
  assert(at2.map((c) => c.clip.id).join(",") === "low,top", "covering clips sort bottom to top");
  assert(at2[0].localSec === 4 && at2[1].localSec === 1, "each covering clip gets its own localSec");
  assert(clipAtPlayhead(stacked, 2)?.clip.id === "top", "clipAtPlayhead is the topmost covering clip");
  assert(clipsAtPlayhead(stacked, 3).map((c) => c.clip.id).join(",") === "top", "lower clip end is exclusive");
  assert(clipsAtPlayhead(stacked, 4).length === 0, "nothing covers the last clip end");
  assert(clipsAtPlayhead(parsed!, 2.5).length === 1, "single covering clip");
  assert(clipsAtPlayhead(parsed!, 2.5)[0].clip.id === clipAtPlayhead(parsed!, 2.5)?.clip.id, "single-clip parity");

  const placed = parseEditorDocument({
    durationSec: 10,
    sequence: [
      {
        id: "c1",
        creationId: "x",
        startSec: 1,
        endSec: 4,
        inSec: 0,
        sourceDurationSec: 5,
        order: 0,
      },
    ],
  });
  assert(projectDurationSec(placed!) === 4, "legacy stored duration ignored; derived from layers");
  assert(placed!.sequence[0].startSec === 1 && placed!.sequence[0].endSec === 4, "legacy layer timing kept");
  const tooLong = clampClipToComposition(
    { ...placed!.sequence[0], endSec: 9, startSec: 1, inSec: 0, sourceDurationSec: 5 }
  );
  assert(tooLong.endSec - tooLong.startSec === 5, "layer cannot exceed source duration");

  const over = parseEditorDocument({
    durationSec: 80,
    sequence: Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      creationId: `id${i}`,
      startSec: 0,
      endSec: 4,
      inSec: 0,
      order: i,
    })),
  });
  assert(over?.sequence.length === EDITOR_MAX_SEQUENCE, "sequence cap at parse");
  assert(projectDurationSec(over!) === 4, "duration derived even when stored duration is out of range");

  // Duration derivation and source caps (#249)
  const clipAt = (id: string, startSec: number, endSec: number, extra: Partial<EditorClip> = {}): EditorClip => ({
    id, creationId: "x", storagePath: null, startSec, endSec, inSec: 0, sourceDurationSec: null,
    order: 0, locked: false, hidden: false, ...extra,
  });
  const ov = (id: string, kind: EditorOverlayKind, startSec: number, endSec: number, extra: Partial<EditorOverlay> = {}): EditorOverlay => ({
    id, kind, startSec, endSec, x: 0, y: 0, w: 0.3, h: 0.3, z: 0, text: kind === "text" ? "t" : null,
    fontSize: null, color: null, creationId: kind === "text" ? null : "m", storagePath: null,
    locked: false, hidden: false, ...extra,
  });
  const base = emptyEditorDocument();
  const probedClip = withProbedClipSource(clipAt("v", 0, 3), 5.2);
  assert(probedClip.sourceDurationSec === 5.2 && probedClip.endSec === 5.2, "new video spans its source length");
  assert(projectDurationSec({ ...base, sequence: [probedClip] }) === 5.2, "duration is the last-ending layer");
  assert(withProbedClipSource(probedClip, 9).endSec === 5.2, "re-probe does not reset a known source");
  const editedClip = withProbedClipSource(clipAt("v", 0, 1.5), 5.2, false);
  assert(editedClip.endSec === 1.5 && editedClip.sourceDurationSec === 5.2, "probe keeps a span the user already edited");
  assert(withProbedClipSource(clipAt("v", 0, 8), 5.2, false).endSec === 5.2, "edited span is still capped by the source");
  const longClip = withProbedClipSource(clipAt("v", 10, 13), 120);
  assert(longClip.endSec === EDITOR_MAX_DURATION_SEC, "long video default span fits the cap");
  const offsetClip = withProbedClipSource(clipAt("v", 1, 3, { inSec: 2 }), 5);
  assert(offsetClip.endSec === 4, "probed span is source minus inSec");
  const stretchedText = clampOverlayToComposition(ov("t", "text", 0, 20));
  const stretchedImage = clampOverlayToComposition(ov("i", "image", 2, 20));
  assert(stretchedText.endSec === 20 && stretchedImage.endSec === 20, "text and images stretch freely");
  assert(projectDurationSec({ ...base, overlays: [stretchedText] }) === 20, "stretching a strip grows the duration");
  assert(clampOverlayToComposition(ov("t", "text", 0, 90)).endSec === EDITOR_MAX_DURATION_SEC, "overlay capped at 60s");
  assert(
    clampClipToComposition(clipAt("v", 1, 20, { inSec: 2, sourceDurationSec: 6 })).endSec === 5,
    "video clip end stops at sourceDuration - inSec"
  );
  assert(clampClipToComposition(clipAt("v", 0, 20)).endSec === 20, "unprobed clip stays uncapped");
  const probedOverlay = withProbedOverlaySource(ov("o", "video", 1, 3), 4);
  assert(probedOverlay.sourceDurationSec === 4 && probedOverlay.endSec === 5, "new video overlay spans its source");
  assert(clampOverlayToComposition({ ...probedOverlay, endSec: 30 }).endSec === 5, "video overlay end stops at source length");
  assert(withProbedOverlaySource(ov("i", "image", 0, 2), 4).sourceDurationSec === undefined, "image overlays have no source length");
  // Re-measuring a saved layer with no source length (#270)
  const unmeasured = {
    ...base,
    sequence: [clipAt("placeholder", 0, 3), clipAt("stretched", 2.1, 16.7)],
    overlays: [ov("ovPlaceholder", "video", 1, 3), ov("ovStretched", "video", 0, 20)],
  };
  // Left-edge drag math: end and source out-point stay fixed.
  const tsA = trimStartBy(1, 11, 0, 2.04);
  assert(tsA.startSec === 3 && tsA.inSec === 2, "drag right advances start and in together");
  assert(trimStartBy(3, 11, 2, -9).startSec === 1 && trimStartBy(3, 11, 2, -9).inSec === 0, "drag left stops at source start");
  assert(trimStartBy(0, 11, 0, -5).startSec === 0, "cannot go before timeline start");
  assert(trimStartBy(1, 11, 0, 50).startSec === 10.8, "min span 0.2 kept");
  assert(trimStartBy(1, 3, undefined, 0.5).inSec === undefined, "no source: in untouched");
  assert(trimStartBy(3, 11, undefined, -9).startSec === 0, "no source: free down to 0");
  const ovIn = parseEditorDocument({
    v: EDITOR_DOCUMENT_VERSION,
    aspect: "9:16",
    sequence: [],
    overlays: [
      { id: "a", kind: "video", startSec: 0, endSec: 2, inSec: 1.23 },
      { id: "b", kind: "video", startSec: 0, endSec: 2 },
      { id: "c", kind: "image", startSec: 0, endSec: 2, inSec: 4 },
    ],
  });
  assert(ovIn?.overlays[0].inSec === 1.2 && ovIn.overlays[1].inSec === 0 && ovIn.overlays[2].inSec === undefined, "overlay inSec sanitised");
  const measureAll = (doc: EditorDocument, sec: number) =>
    [...doc.sequence, ...doc.overlays].reduce(
      (current, layer) => withProbedLayerSource(current, layer.id, sec, isPlaceholderSpan),
      doc
    );
  const remeasured = measureAll(unmeasured, 10);
  const byId = (id: string) => [...remeasured.sequence, ...remeasured.overlays].find((l) => l.id === id)!;
  assert(byId("placeholder").endSec === 10 && byId("placeholder").sourceDurationSec === 10, "placeholder clip fills its source");
  assert(byId("stretched").endSec === 12.1, "stretched clip is capped at its source end");
  assert(byId("ovPlaceholder").endSec === 11, "placeholder video overlay fills its source");
  assert(byId("ovStretched").endSec === 10, "stretched video overlay is capped at its source");
  assert(measureAll(remeasured, 4) === remeasured, "measured layers are left alone");
  const twoLayers = { ...base, sequence: [clipAt("a", 0, 4), clipAt("b", 2, 9)], overlays: [ov("t", "text", 0, 6)] };
  assert(projectDurationSec(twoLayers) === 9, "duration is the latest end across layers");
  assert(projectDurationSec({ ...twoLayers, sequence: [clipAt("a", 0, 4)] }) === 6, "deleting the last layer shrinks duration");
  assert(
    projectDurationSec({ ...twoLayers, sequence: [clipAt("a", 0, 4), clipAt("b", 2, 3)] }) === 6,
    "shortening the last layer shrinks duration"
  );
  assert(
    projectDurationSec({ ...base, sequence: [clipAt("a", 50, 70)] }) === EDITOR_MAX_DURATION_SEC,
    "duration never exceeds the cap"
  );
  const savedOverlay = parseEditorDocument({
    overlays: [{ id: "sv", kind: "video", startSec: 0, endSec: 9, sourceDurationSec: 3 }],
  });
  assert(savedOverlay?.overlays[0].sourceDurationSec === 3 && savedOverlay.overlays[0].endSec === 3, "video overlay source parsed and enforced");

  assert(normalizeEditorTitle("   ") === DEFAULT_EDITOR_TITLE, "blank title falls back");
  assert(normalizeEditorTitle("x".repeat(200)).length === EDITOR_TITLE_MAX, "title cap");

  assert(parsed!.sequence.every((c) => c.locked === false && c.hidden === false), "clips default unlocked and visible");
  const withFlags = parseEditorDocument({
    durationSec: 5,
    sequence: [
      { id: "f1", creationId: "x", startSec: 0, endSec: 2, inSec: 0, order: 0, locked: true, hidden: true },
    ],
    overlays: [{ id: "fo1", kind: "text", startSec: 0, endSec: 2, text: "hi", locked: true, hidden: true }],
  });
  assert(withFlags?.sequence[0]?.locked === true && withFlags?.sequence[0]?.hidden === true, "clip locked/hidden parsed");
  assert(withFlags?.overlays[0]?.locked === true && withFlags?.overlays[0]?.hidden === true, "overlay locked/hidden parsed");

  const reordered = reorderById([{ id: "a" }, { id: "b" }, { id: "c" }], "a", "c");
  assert(reordered?.map((x) => x.id).join(",") === "b,c,a", "reorderById moves source next to target");
  assert(reorderById([{ id: "a" }], "a", "a") === null, "reorderById no-ops when source equals target");

  // Muted tests
  assert(parsed!.sequence.every((c) => c.muted === false), "clips default unmuted (false)");
  const withMute = parseEditorDocument({
    durationSec: 5,
    sequence: [
      { id: "m1", creationId: "x", startSec: 0, endSec: 2, inSec: 0, order: 0, muted: true },
      { id: "m2", creationId: "y", startSec: 2, endSec: 4, inSec: 0, order: 1, muted: false },
    ],
    overlays: [
      { id: "vm1", kind: "video", startSec: 0, endSec: 2, muted: true },
      { id: "vm2", kind: "video", startSec: 2, endSec: 4, muted: false },
      { id: "tm1", kind: "text", startSec: 0, endSec: 2, text: "t", muted: true },
    ],
  });
  assert(withMute?.sequence[0]?.muted === true, "clip muted=true parsed");
  assert(withMute?.sequence[1]?.muted === false, "clip muted=false parsed");
  assert(withMute?.overlays[0]?.muted === true, "video overlay muted=true parsed");
  assert(withMute?.overlays[1]?.muted === false, "video overlay muted=false parsed");
  assert(withMute?.overlays[2]?.muted === undefined, "text overlay muted omitted (undefined)");

  // Backward compatibility: legacy document without muted field
  const legacyDoc = parseEditorDocument({
    v: 1,
    durationSec: 5,
    sequence: [{ id: "leg1", startSec: 0, endSec: 2 }],
  });
  assert(legacyDoc?.sequence[0]?.muted === false, "legacy clip without muted field defaults to false");

  // Upload validation tests
  const oversized = validateEditorUploadFile({ size: EDITOR_MAX_UPLOAD_BYTES + 1, type: "video/mp4", name: "big.mp4" });
  assert(!oversized.ok && oversized.error.includes("too large"), "oversized file rejected");
  assert(!oversized.ok && oversized.error.includes("25 MB"), "oversized error mentions 25 MB");
  // Literal 25 MB on purpose: pins the #243 limit so a constant change fails here.
  const atLimit = validateEditorUploadFile({ size: 25 * 1024 * 1024, type: "video/mp4", name: "limit.mp4" });
  assert(atLimit.ok, "exactly 25 MB upload accepted");
  const overLimit = validateEditorUploadFile({ size: 25 * 1024 * 1024 + 1, type: "video/mp4", name: "over.mp4" });
  assert(!overLimit.ok, "25 MB + 1 byte upload rejected");

  const badType = validateEditorUploadFile({ size: 1024, type: "application/pdf", name: "doc.pdf" });
  assert(!badType.ok && badType.error.includes("isn't supported"), "unsupported mime type rejected");

  const validVideo = validateEditorUploadFile({ size: 1024 * 1024, type: "video/mp4", name: "v.mp4" }, "sequence");
  assert(validVideo.ok, "valid mp4 sequence upload accepted");

  const validMov = validateEditorUploadFile({ size: 1024 * 1024, type: "video/quicktime", name: "v.mov" }, "video");
  assert(validMov.ok, "valid mov overlay upload accepted");

  const validWebp = validateEditorUploadFile({ size: 500, type: "image/webp", name: "img.webp" }, "image");
  assert(validWebp.ok, "valid webp image upload accepted");

  const imageForSequence = validateEditorUploadFile({ size: 500, type: "image/png", name: "img.png" }, "sequence");
  assert(!imageForSequence.ok, "image rejected for video sequence");

  const videoForImage = validateEditorUploadFile({ size: 1024, type: "video/mp4", name: "v.mp4" }, "image");
  assert(!videoForImage.ok, "video rejected for image overlay");

  // Split & trim pure tests
  const testDoc: EditorDocument = {
    v: 1,
    aspect: "9:16",
    sequence: [
      {
        id: "c-split",
        creationId: "item-1",
        storagePath: null,
        startSec: 1.0,
        endSec: 5.0,
        inSec: 0.5,
        sourceDurationSec: 10,
        order: 0,
        locked: false,
        hidden: false,
      },
    ],
    overlays: [],
  };

  // Split rejects:
  assert(!canSplitClip(testDoc.sequence[0], 1.0), "split at clip start rejected");
  assert(!canSplitClip(testDoc.sequence[0], 5.0), "split at clip end rejected");
  assert(!canSplitClip(testDoc.sequence[0], 1.1), "split below min span rejected");
  assert(!canSplitClip(testDoc.sequence[0], 4.9), "split near end below min span rejected");
  assert(!canSplitClip({ ...testDoc.sequence[0], locked: true }, 3.0), "locked clip split rejected");

  // Valid split at 3.0s:
  const splitResult = splitEditorClip(testDoc, "c-split", 3.0, "c-split-r");
  assert(splitResult !== null, "valid split succeeds");
  assert(splitResult.doc.sequence.length === 2, "split produces 2 clips");
  const left = splitResult.doc.sequence[0];
  const right = splitResult.doc.sequence[1];
  assert(left.id === "c-split", "left keeps original id");
  assert(left.startSec === 1.0 && left.endSec === 3.0, "left bounds: 1.0 - 3.0");
  assert(left.inSec === 0.5, "left inSec preserved: 0.5");
  assert(left.order === 0, "left order is 0");
  assert(right.id === "c-split-r", "right has specified new id");
  assert(right.startSec === 3.0 && right.endSec === 5.0, "right bounds: 3.0 - 5.0");
  assert(right.inSec === 2.5, "right inSec calculated correctly: 2.5");
  assert(right.order === 1, "right order is reindexed to 1");

  // Trim start tests
  assert(!canTrimClipStart(testDoc.sequence[0], 1.0), "trim start at same position rejected");
  assert(!canTrimClipStart(testDoc.sequence[0], 4.9), "trim start leaving < min span rejected");
  assert(!canTrimClipStart({ ...testDoc.sequence[0], locked: true }, 2.0), "trim start on locked clip rejected");
  const trimmedStart = trimClipStartToPlayhead(testDoc, "c-split", 2.0);
  assert(trimmedStart !== null, "trim start succeeds");
  assert(trimmedStart.sequence[0].startSec === 2.0, "trimmed start is 2.0");
  assert(trimmedStart.sequence[0].inSec === 1.5, "trimmed inSec is 1.5 (0.5 + 1.0)");

  // Trim end tests
  assert(!canTrimClipEnd(testDoc.sequence[0], 5.0), "trim end at same position rejected");
  assert(!canTrimClipEnd(testDoc.sequence[0], 1.1), "trim end leaving < min span rejected");
  assert(!canTrimClipEnd({ ...testDoc.sequence[0], locked: true }, 4.0), "trim end on locked clip rejected");
  const trimmedEnd = trimClipEndToPlayhead(testDoc, "c-split", 4.0);
  assert(trimmedEnd !== null, "trim end succeeds");
  assert(trimmedEnd.sequence[0].endSec === 4.0, "trimmed end is 4.0");
  assert(trimmedEnd.sequence[0].inSec === 0.5, "trim end leaves inSec unchanged: 0.5");

  // Multi-clip out-of-order split, locked->null, non-existent id->null, right clip properties
  const outOfOrderDoc: EditorDocument = {
    ...emptyEditorDocument(),
    sequence: [
      {
        id: "c-third",
        creationId: "c3",
        storagePath: null,
        startSec: 6.0,
        endSec: 9.0,
        inSec: 0,
        sourceDurationSec: 15,
        order: 2,
        locked: false,
        hidden: true,
      },
      {
        id: "c-first",
        creationId: "c1",
        storagePath: null,
        startSec: 0.0,
        endSec: 3.0,
        inSec: 0,
        sourceDurationSec: 10,
        order: 0,
        locked: false,
        hidden: false,
      },
      {
        id: "c-second",
        creationId: "c2",
        storagePath: null,
        startSec: 3.0,
        endSec: 6.0,
        inSec: 0,
        sourceDurationSec: null,
        order: 1,
        locked: false,
        hidden: false,
      },
    ],
  };

  // locked -> null
  const lockedDoc: EditorDocument = {
    ...outOfOrderDoc,
    sequence: outOfOrderDoc.sequence.map((c) => (c.id === "c-first" ? { ...c, locked: true } : c)),
  };
  assert(splitEditorClip(lockedDoc, "c-first", 1.5) === null, "locked clip split returns null");

  // non-existent id -> null
  assert(splitEditorClip(outOfOrderDoc, "non-existent-id", 1.5) === null, "non-existent id split returns null");

  // Multi-clip out-of-order split on c-third
  const oooSplit = splitEditorClip(outOfOrderDoc, "c-third", 7.5, "c-third-r");
  assert(oooSplit !== null, "out-of-order multi-clip split succeeds");
  assert(oooSplit.doc.sequence.length === 4, "out-of-order split results in 4 clips");
  const reindexedIds = oooSplit.doc.sequence.map((c) => c.id);
  assert(
    reindexedIds.join(",") === "c-first,c-second,c-third,c-third-r",
    "reindexed in sorted order with right clip immediately after left"
  );
  assert(oooSplit.doc.sequence.every((c, i) => c.order === i), "all orders sequential 0..3");

  // Right clip preserves non-default sourceDurationSec, locked, hidden
  const rightOoo = oooSplit.doc.sequence.find((c) => c.id === "c-third-r")!;
  assert(rightOoo.sourceDurationSec === 15, "right clip preserves non-default sourceDurationSec");
  assert(rightOoo.hidden === true, "right clip preserves non-default hidden");
  assert(rightOoo.locked === false, "right clip preserves locked state");

  // Trim start near source boundary
  const sourceCappedDoc: EditorDocument = {
    ...emptyEditorDocument(),
    sequence: [
      {
        id: "c-bounded",
        creationId: "b1",
        storagePath: null,
        startSec: 0.0,
        endSec: 4.0,
        inSec: 0.0,
        sourceDurationSec: 5.0,
        order: 0,
        locked: false,
        hidden: false,
      },
    ],
  };
  const trimmedNearBound = trimClipStartToPlayhead(sourceCappedDoc, "c-bounded", 3.5);
  assert(trimmedNearBound !== null, "trim start near source boundary succeeds");
  assert(trimmedNearBound.sequence[0].startSec === 3.5, "trimmed startSec is 3.5");
  assert(trimmedNearBound.sequence[0].inSec === 3.5, "trimmed inSec is 3.5 near source boundary");

  const trimmedMinSpan = trimClipStartToPlayhead(sourceCappedDoc, "c-bounded", 3.8);
  assert(trimmedMinSpan !== null, "trim start leaving min span succeeds");
  assert(trimmedMinSpan.sequence[0].startSec === 3.8, "trimmed startSec is 3.8");
  assert(trimmedMinSpan.sequence[0].inSec === 3.8, "trimmed inSec is 3.8");

  // Layer name normalization & resolution tests
  assert(normalizeLayerName(null) === null, "null name normalizes to null");
  assert(normalizeLayerName("   ") === null, "whitespace name normalizes to null");
  assert(normalizeLayerName("  Intro Clip  ") === "Intro Clip", "name trims whitespace");
  assert(normalizeLayerName("a".repeat(100))?.length === LAYER_NAME_MAX, "name caps to max length");

  const namedDoc = parseEditorDocument({
    durationSec: 5,
    sequence: [
      { id: "n1", creationId: "x", startSec: 0, endSec: 2, inSec: 0, order: 0, name: "  Scene 1  " },
      { id: "n2", creationId: "y", startSec: 2, endSec: 4, inSec: 0, order: 1 },
    ],
    overlays: [
      { id: "no1", kind: "text", startSec: 0, endSec: 2, text: "Sub", name: "Custom Caption" },
      { id: "no2", kind: "image", startSec: 0, endSec: 2, name: null },
    ],
  });
  assert(namedDoc?.sequence[0].name === "Scene 1", "clip name parsed and trimmed");
  assert(namedDoc?.sequence[1].name === null, "clip without name defaults to null");
  assert(namedDoc?.overlays[0].name === "Custom Caption", "overlay custom name parsed");
  assert(namedDoc?.overlays[1].name === null, "overlay null name parsed as null");

  assert(resolveLayerLabel(namedDoc!.sequence[0], 0) === "Scene 1", "resolveLayerLabel uses custom name");
  assert(resolveLayerLabel(namedDoc!.sequence[1], 1) === "Clip 2", "resolveLayerLabel falls back to Clip 2");
  assert(resolveLayerLabel(namedDoc!.overlays[0]) === "Custom Caption", "resolveLayerLabel uses custom overlay name");
  assert(resolveLayerLabel(namedDoc!.overlays[1]) === "Image overlay", "resolveLayerLabel falls back to Image overlay");

  // Device media kept local until export (#245)
  assert(parsed!.sequence.every((c) => c.localMediaId === null), "old documents parse with localMediaId null");
  const localDoc = parseEditorDocument({
    sequence: [{ id: "l1", localMediaId: "abc-123", startSec: 0, endSec: 2 }],
    overlays: [
      { id: "lo1", kind: "image", localMediaId: "img-1", startSec: 0, endSec: 2 },
      { id: "lt1", kind: "text", localMediaId: "nope", text: "t", startSec: 0, endSec: 2 },
      { id: "lb1", kind: "video", localMediaId: "blob:http://x/y", startSec: 0, endSec: 2 },
    ],
  })!;
  assert(localDoc.sequence[0].localMediaId === "abc-123", "clip localMediaId kept");
  assert(localDoc.overlays[0].localMediaId === "img-1", "overlay localMediaId kept");
  assert(localDoc.overlays[1].localMediaId === null, "text overlays never hold local media");
  assert(localDoc.overlays[2].localMediaId === null, "invalid localMediaId (blob URL) dropped");
  assert(isLocalOnlyLayer(localDoc.sequence[0]), "localMediaId without storage is local-only");
  assert(validateEditorExport(localDoc)?.code === "CLIP_SOURCE", "server export rejects local-only layers");
  assert(
    validateEditorExport({ ...localDoc, overlays: localDoc.overlays.slice(0, 2) }, { allowLocal: true }) === null,
    "client pre-check accepts local layers"
  );

  const owner = "user-1/videos/temp/refs/";
  const tmp = `${owner}1-a-clip.mp4`;
  const exportDoc: EditorDocument = {
    ...localDoc,
    sequence: [{ ...localDoc.sequence[0], storagePath: tmp }],
    overlays: [{ ...localDoc.overlays[0], storagePath: "user-1/videos/generated/keep.mp4" }],
  };
  const ok = acceptEditorExportUploads([{ localMediaId: "abc-123", storagePath: tmp }], exportDoc, owner);
  assert(ok?.length === 1 && ok[0].storagePath === tmp, "own temp upload referenced by its layer accepted");
  assert(acceptEditorExportUploads(undefined, exportDoc, owner)?.length === 0, "no exportUploads is fine");
  const reject = (raw: unknown, why: string) =>
    assert(acceptEditorExportUploads(raw, exportDoc, owner) === null, why);
  reject([{ localMediaId: "abc-123", storagePath: "user-2/videos/temp/refs/1-a-clip.mp4" }], "another user's path rejected");
  reject([{ localMediaId: "img-1", storagePath: "user-1/videos/generated/keep.mp4" }], "non-temp path rejected");
  reject([{ localMediaId: "abc-123", storagePath: `${owner}sub/x.mp4` }], "nested path rejected");
  reject([{ localMediaId: "abc-123", storagePath: owner }], "bare prefix rejected");
  reject([{ localMediaId: "other", storagePath: tmp }], "path not referenced by a matching layer rejected");
  reject([{ localMediaId: "abc-123", storagePath: `${owner}1-b-unused.mp4` }], "unreferenced own temp path rejected");
  reject("x", "non-array rejected");

  const hashDoc = editorExportHashDocument(exportDoc, ok!);
  assert(hashDoc.sequence[0].storagePath === "local:abc-123", "uploaded layer hashes its localMediaId");
  assert(hashDoc.overlays[0].storagePath === "user-1/videos/generated/keep.mp4", "stored layers hash their path");
  const retryDoc: EditorDocument = { ...exportDoc, sequence: [{ ...exportDoc.sequence[0], storagePath: `${owner}2-c-clip.mp4` }] };
  const retryHash = editorExportHashDocument(
    retryDoc,
    acceptEditorExportUploads([{ localMediaId: "abc-123", storagePath: `${owner}2-c-clip.mp4` }], retryDoc, owner)!
  );
  assert(JSON.stringify(retryHash) === JSON.stringify(hashDoc), "re-uploaded retry hashes identically");

  // textOverlayLayout tests
  const sampleOverlay: Pick<EditorOverlay, "x" | "y" | "w" | "h" | "fontSize"> = {
    x: 0.1,
    y: 0.2,
    w: 0.8,
    h: 0.15,
    fontSize: 48,
  };
  const layout916 = textOverlayLayout(sampleOverlay, EDITOR_CANVAS["9:16"]);
  assert(layout916.box.x === 72 && layout916.box.y === 256, "box x/y scaled to 9:16 canvas");
  assert(layout916.box.w === 576 && layout916.box.h === 192, "box w/h scaled to 9:16 canvas");
  assert(layout916.fontSize === 48, "explicit font size preserved");
  assert(layout916.alignment.horizontal === "center" && layout916.alignment.vertical === "center", "center alignment");
  assert(layout916.lineHeight === 1.5, "line height matches drawtext Poppins line pitch");
  assert(layout916.shadow.color === "black@0.6" && layout916.shadow.x === 2 && layout916.shadow.y === 2, "shadow parameters");

  // Clamping tests
  const clampedLow = textOverlayLayout({ ...sampleOverlay, fontSize: 5 }, EDITOR_CANVAS["9:16"]);
  assert(clampedLow.fontSize === EDITOR_TEXT_MIN_FONT_SIZE, "font size clamped to min 12");
  const clampedHigh = textOverlayLayout({ ...sampleOverlay, fontSize: 500 }, EDITOR_CANVAS["9:16"]);
  assert(clampedHigh.fontSize === EDITOR_TEXT_MAX_FONT_SIZE, "font size clamped to max 200");
  const defaultSize = textOverlayLayout({ ...sampleOverlay, fontSize: null }, EDITOR_CANVAS["9:16"]);
  assert(defaultSize.fontSize === EDITOR_TEXT_DEFAULT_FONT_SIZE, "null font size defaults to 48");
  const scaled = textOverlayLayout({ ...sampleOverlay, fontSize: 500 }, { w: 2160, h: 3840 }, 3);
  assert(scaled.fontSize === 600, "font clamp applies before export scaling");
  assert(scaled.shadow.x === 6 && scaled.shadow.y === 6, "shadow scales with export height");
}

if (require.main === module) {
  editorDocumentSelfCheck();
  console.log("editorDocumentSelfCheck: ok");
}
