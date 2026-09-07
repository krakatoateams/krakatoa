/**
 * Persistable Editor timeline. Clips and overlays are layers on a composition
 * of fixed duration. Media is referenced by creationId or storagePath — never
 * blob/signed URLs — so a reload can re-sign.
 *
 * Pure — runnable as `npx tsx lib/editor-document.ts`.
 */

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

export type EditorClip = {
  id: string;
  creationId: string | null;
  storagePath: string | null;
  /** Timeline placement. */
  startSec: number;
  endSec: number;
  /** Source in-point. Source out is inSec + (endSec - startSec). */
  inSec: number;
  /** Known source length; layer span cannot exceed sourceDuration - inSec. */
  sourceDurationSec: number | null;
  order: number;
};

export type EditorOverlayKind = "text" | "image" | "video";

export type EditorOverlay = {
  id: string;
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
};

export type EditorDocument = {
  v: typeof EDITOR_DOCUMENT_VERSION;
  aspect: EditorAspect;
  durationSec: number;
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

function asAspect(value: unknown): EditorAspect {
  return EDITOR_ASPECTS.includes(value as EditorAspect) ? (value as EditorAspect) : "9:16";
}

export function emptyEditorDocument(): EditorDocument {
  return {
    v: EDITOR_DOCUMENT_VERSION,
    aspect: "9:16",
    durationSec: DEFAULT_EDITOR_DURATION_SEC,
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

export function projectDurationSec(doc: EditorDocument): number {
  return snapTenth(clamp(doc.durationSec, 0.1, EDITOR_MAX_DURATION_SEC));
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

export function clipAtPlayhead(
  doc: EditorDocument,
  playheadSec: number
): { clip: EditorClip; localSec: number; timelineStart: number } | null {
  const covering = doc.sequence
    .filter((clip) => playheadSec >= clip.startSec && playheadSec < clip.endSec)
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const clip = covering[covering.length - 1];
  if (!clip) return null;
  return {
    clip,
    localSec: clip.inSec + (playheadSec - clip.startSec),
    timelineStart: clip.startSec,
  };
}

export function clampClipToComposition(clip: EditorClip, durationSec: number): EditorClip {
  const duration = snapTenth(clamp(durationSec, 0.1, EDITOR_MAX_DURATION_SEC));
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

export function clampOverlayToComposition(
  overlay: EditorOverlay,
  durationSec: number
): EditorOverlay {
  const duration = snapTenth(clamp(durationSec, 0.1, EDITOR_MAX_DURATION_SEC));
  let startSec = snapTenth(clamp(overlay.startSec, 0, Math.max(0, duration - 0.1)));
  let endSec = snapTenth(clamp(overlay.endSec, startSec + 0.1, duration));
  if (endSec <= startSec) {
    startSec = 0;
    endSec = snapTenth(Math.min(duration, 0.1));
  }
  return { ...overlay, startSec, endSec };
}

export function withProjectDuration(doc: EditorDocument, durationSec: number): EditorDocument {
  const next = snapTenth(clamp(durationSec, 0.1, EDITOR_MAX_DURATION_SEC));
  return {
    ...doc,
    durationSec: next,
    sequence: doc.sequence.map((clip) => clampClipToComposition(clip, next)),
    overlays: doc.overlays.map((overlay) => clampOverlayToComposition(overlay, next)),
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
    creationId: asId(o.creationId),
    storagePath: asPath(o.storagePath),
    startSec,
    endSec,
    inSec,
    sourceDurationSec,
    order: Number.isFinite(asFiniteNumber(o.order, index)) ? asFiniteNumber(o.order, index) : index,
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
  return {
    id,
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
  const clipEnds = parsedClips.map((c) => c.endSec);
  const overlayEnds = overlays.map((ov) => ov.endSec);
  const inferred = Math.max(
    DEFAULT_EDITOR_DURATION_SEC,
    ...clipEnds,
    ...overlayEnds,
    0
  );
  const durationSec = snapTenth(
    clamp(
      asFiniteNumber(o.durationSec, inferred) || inferred,
      0.1,
      EDITOR_MAX_DURATION_SEC
    )
  );
  const sequence = parsedClips.map((clip) =>
    clampClipToComposition(
      {
        id: clip.id,
        creationId: clip.creationId,
        storagePath: clip.storagePath,
        startSec: clip.startSec,
        endSec: clip.endSec,
        inSec: clip.inSec,
        sourceDurationSec: clip.sourceDurationSec,
        order: clip.order,
      },
      durationSec
    )
  );
  return {
    v: EDITOR_DOCUMENT_VERSION,
    aspect: asAspect(o.aspect),
    durationSec,
    sequence,
    overlays: overlays.map((overlay) => clampOverlayToComposition(overlay, durationSec)),
  };
}

export function editorDocumentJsonTooLarge(doc: EditorDocument): boolean {
  return JSON.stringify(doc).length > EDITOR_DOCUMENT_JSON_MAX;
}

export function clipHasSource(clip: EditorClip): boolean {
  return Boolean(clip.creationId || clip.storagePath);
}

export function overlayHasSource(overlay: EditorOverlay): boolean {
  if (overlay.kind === "text") return Boolean(overlay.text?.trim());
  return Boolean(overlay.creationId || overlay.storagePath);
}

export type EditorExportError = { code: string; message: string };

export function validateEditorExport(doc: EditorDocument): EditorExportError | null {
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
    if (!clipHasSource(clip)) {
      return { code: "CLIP_SOURCE", message: "Every sequence clip needs a library item or upload." };
    }
    if (clip.endSec - clip.startSec > maxClipLayerDurationSec(clip) + 0.05) {
      return { code: "CLIP_SOURCE_LENGTH", message: "A clip layer is longer than its source video." };
    }
  }
  for (const overlay of doc.overlays) {
    if (!overlayHasSource(overlay)) {
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

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`editor-document self-check: ${msg}`);
}

export function editorDocumentSelfCheck(): void {
  const empty = emptyEditorDocument();
  assert(empty.sequence.length === 0 && empty.aspect === "9:16", "empty document defaults");
  assert(empty.durationSec === DEFAULT_EDITOR_DURATION_SEC, "empty composition is 8s");
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
  assert(parsed!.durationSec === 8, "composition defaults to 8s when longer than packed clips");
  assert(validateEditorExport(parsed!) === null, "valid export");
  assert(clipAtPlayhead(parsed!, 0)?.clip.id === "b", "playhead 0 is first packed clip");
  assert(clipAtPlayhead(parsed!, 2.5)?.clip.id === "a", "playhead crosses into second clip");
  assert(clipAtPlayhead(parsed!, 7.5) === null, "gap after clips is empty");

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
  assert(placed?.durationSec === 10, "explicit duration kept");
  assert(placed!.sequence[0].endSec - placed!.sequence[0].startSec === 3, "layer span 3s");
  const tooLong = clampClipToComposition(
    { ...placed!.sequence[0], endSec: 9, startSec: 1, inSec: 0, sourceDurationSec: 5 },
    10
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
  assert(over?.durationSec === EDITOR_MAX_DURATION_SEC, "duration clamps to 60s");

  assert(normalizeEditorTitle("   ") === DEFAULT_EDITOR_TITLE, "blank title falls back");
  assert(normalizeEditorTitle("x".repeat(200)).length === EDITOR_TITLE_MAX, "title cap");
}

if (require.main === module) {
  editorDocumentSelfCheck();
  console.log("editorDocumentSelfCheck: ok");
}
