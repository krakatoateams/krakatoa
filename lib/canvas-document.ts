/**
 * Persistable Canvas graph. Strips ephemeral UI (loading, blob/signed URLs)
 * so a reload can re-sign from storagePath / creationId.
 *
 * Pure — runnable as `npx tsx lib/canvas-document.ts`.
 */

import {
  CANVAS_HANDLES,
  CANVAS_NODE_KINDS,
  type CanvasNodeKind,
} from "./canvas-graph";

export const CANVAS_GRAPH_VERSION = 1;
export const CANVAS_TITLE_MAX = 80;
export const CANVAS_MAX_NODES = 80;
export const CANVAS_MAX_EDGES = 160;
export const CANVAS_GRAPH_JSON_MAX = 400_000;
export const DEFAULT_CANVAS_TITLE = "Untitled canvas";

export type SavedCanvasViewport = { x: number; y: number; zoom: number };

export type SavedPromptData = {
  kind: "prompt";
  label: string;
  prompt: string;
  text: string;
  modelId: string;
};

export type SavedImageData = {
  kind: "image";
  label: string;
  prompt: string;
  modelTier: string;
  resolution: string;
  aspectRatio: string;
  resultStoragePath: string | null;
  creationId: string | null;
  imported: boolean;
};

export type SavedVideoData = {
  kind: "video";
  label: string;
  prompt: string;
  modelId: string;
  duration: number;
  resolution: string;
  aspectRatio: string;
  generateAudio?: boolean;
  resultStoragePath: string | null;
  creationId: string | null;
  imported: boolean;
};

export type SavedSoundData = {
  kind: "sound";
  label: string;
  resultStoragePath: string | null;
  creationId: string | null;
  imported: boolean;
};

export type SavedNodeData = SavedPromptData | SavedImageData | SavedVideoData | SavedSoundData;

export type SavedCanvasNode = {
  id: string;
  type: CanvasNodeKind;
  position: { x: number; y: number };
  data: SavedNodeData;
};

export type SavedCanvasEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
};

export type SavedCanvasGraph = {
  v: typeof CANVAS_GRAPH_VERSION;
  nodes: SavedCanvasNode[];
  edges: SavedCanvasEdge[];
  viewport: SavedCanvasViewport;
};

export type CanvasSummary = {
  id: string;
  title: string;
  updatedAt: string;
  createdAt: string;
  nodeCount: number;
};

export type CanvasFlowSnapshotNode = {
  id: string;
  type?: string | null;
  position: { x: number; y: number };
  data?: Record<string, unknown> | null;
};

export type CanvasFlowSnapshotEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

const ID_MAX = 64;
const TEXT_MAX = 8000;
const PATH_MAX = 512;

function asFiniteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asTrimmed(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, max);
}

function asNullableId(value: unknown): string | null {
  const text = asTrimmed(value, ID_MAX);
  return text || null;
}

function asNullablePath(value: unknown): string | null {
  const text = asTrimmed(value, PATH_MAX);
  if (!text || text.startsWith("blob:")) return null;
  return text;
}

function kindOf(value: unknown): CanvasNodeKind | null {
  if (value === "prompt" || value === "image" || value === "video" || value === "sound") return value;
  return null;
}

function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(2, Math.max(0.25, zoom));
}

export function normalizeCanvasTitle(raw: unknown): string {
  const title = typeof raw === "string" ? raw.trim().slice(0, CANVAS_TITLE_MAX) : "";
  return title || DEFAULT_CANVAS_TITLE;
}

function persistLabel(data: Record<string, unknown>): string {
  return asTrimmed(data.label, 40);
}

function persistPrompt(data: Record<string, unknown>): SavedPromptData {
  const text = asTrimmed(data.text, TEXT_MAX);
  const prompt = asTrimmed(data.prompt, TEXT_MAX) || text;
  return {
    kind: "prompt",
    label: persistLabel(data),
    prompt,
    text,
    modelId: asTrimmed(data.modelId, 40) || "gpt5",
  };
}

function persistImage(data: Record<string, unknown>): SavedImageData {
  return {
    kind: "image",
    label: persistLabel(data),
    prompt: asTrimmed(data.prompt, TEXT_MAX),
    modelTier: asTrimmed(data.modelTier, 40) || "basic",
    resolution: asTrimmed(data.resolution, 8) || "1k",
    aspectRatio: asTrimmed(data.aspectRatio, 8) || "1:1",
    resultStoragePath: asNullablePath(data.resultStoragePath),
    creationId: asNullableId(data.creationId),
    imported: data.imported === true,
  };
}

function persistVideo(data: Record<string, unknown>): SavedVideoData {
  const duration = asFiniteNumber(data.duration, 5);
  return {
    kind: "video",
    label: persistLabel(data),
    prompt: asTrimmed(data.prompt, TEXT_MAX),
    modelId: asTrimmed(data.modelId, 40) || "seedance2_fast",
    duration: Math.min(15, Math.max(1, Math.round(duration))),
    resolution: asTrimmed(data.resolution, 8) || "720p",
    aspectRatio: asTrimmed(data.aspectRatio, 8) || "16:9",
    resultStoragePath: asNullablePath(data.resultStoragePath),
    creationId: asNullableId(data.creationId),
    imported: data.imported === true,
    ...(typeof data.generateAudio === "boolean" ? { generateAudio: data.generateAudio } : {}),
  };
}

function persistSound(data: Record<string, unknown>): SavedSoundData {
  return {
    kind: "sound",
    label: persistLabel(data),
    resultStoragePath: asNullablePath(data.resultStoragePath),
    creationId: asNullableId(data.creationId),
    imported: data.imported === true,
  };
}

function persistNode(node: CanvasFlowSnapshotNode): SavedCanvasNode | null {
  const id = asTrimmed(node.id, ID_MAX);
  const type = kindOf(node.type) ?? kindOf(node.data?.kind);
  if (!id || !type) return null;
  const position = {
    x: asFiniteNumber(node.position?.x),
    y: asFiniteNumber(node.position?.y),
  };
  const raw = node.data && typeof node.data === "object" ? node.data : {};
  const data =
    type === "prompt"
      ? persistPrompt(raw)
      : type === "image"
        ? persistImage(raw)
        : type === "video"
          ? persistVideo(raw)
          : persistSound(raw);
  return { id, type, position, data };
}

export function serializeCanvasGraph(input: {
  nodes: CanvasFlowSnapshotNode[];
  edges: CanvasFlowSnapshotEdge[];
  viewport?: SavedCanvasViewport;
}): SavedCanvasGraph {
  const nodes: SavedCanvasNode[] = [];
  const seen = new Set<string>();
  for (const node of input.nodes) {
    if (nodes.length >= CANVAS_MAX_NODES) break;
    const saved = persistNode(node);
    if (!saved || seen.has(saved.id)) continue;
    seen.add(saved.id);
    nodes.push(saved);
  }

  const edges: SavedCanvasEdge[] = [];
  const edgeIds = new Set<string>();
  for (const edge of input.edges) {
    if (edges.length >= CANVAS_MAX_EDGES) break;
    const id = asTrimmed(edge.id, ID_MAX);
    const source = asTrimmed(edge.source, ID_MAX);
    const target = asTrimmed(edge.target, ID_MAX);
    if (!id || !source || !target || source === target) continue;
    if (!seen.has(source) || !seen.has(target) || edgeIds.has(id)) continue;
    const sourceHandle = asTrimmed(edge.sourceHandle, 16) || CANVAS_HANDLES.out;
    const rawTarget = asTrimmed(edge.targetHandle, 16);
    const targetHandle =
      !rawTarget || rawTarget === "prompt" || rawTarget === "image" || rawTarget === CANVAS_HANDLES.in
        ? CANVAS_HANDLES.in
        : rawTarget;
    edgeIds.add(id);
    edges.push({
      id,
      source,
      target,
      sourceHandle: sourceHandle || null,
      targetHandle: targetHandle || null,
    });
  }

  return {
    v: CANVAS_GRAPH_VERSION,
    nodes,
    edges,
    viewport: {
      x: asFiniteNumber(input.viewport?.x),
      y: asFiniteNumber(input.viewport?.y),
      zoom: clampZoom(asFiniteNumber(input.viewport?.zoom, 1)),
    },
  };
}

export function parseCanvasGraph(raw: unknown): SavedCanvasGraph | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (record.v !== CANVAS_GRAPH_VERSION) return null;
  if (!Array.isArray(record.nodes) || !Array.isArray(record.edges)) return null;
  const viewportRaw =
    record.viewport && typeof record.viewport === "object"
      ? (record.viewport as Record<string, unknown>)
      : {};
  const graph = serializeCanvasGraph({
    nodes: record.nodes as CanvasFlowSnapshotNode[],
    edges: record.edges as CanvasFlowSnapshotEdge[],
    viewport: {
      x: asFiniteNumber(viewportRaw.x),
      y: asFiniteNumber(viewportRaw.y),
      zoom: asFiniteNumber(viewportRaw.zoom, 1),
    },
  });
  const encoded = JSON.stringify(graph);
  if (encoded.length > CANVAS_GRAPH_JSON_MAX) return null;
  return graph;
}

export function canvasGraphJsonTooLarge(graph: SavedCanvasGraph): boolean {
  return JSON.stringify(graph).length > CANVAS_GRAPH_JSON_MAX;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`canvas-document self-check: ${msg}`);
}

export function canvasDocumentSelfCheck(): void {
  assert(
    normalizeCanvasTitle("  ") === DEFAULT_CANVAS_TITLE,
    "blank titles fall back to Untitled canvas"
  );
  assert(normalizeCanvasTitle("x".repeat(90)).length === CANVAS_TITLE_MAX, "titles are capped");

  const saved = serializeCanvasGraph({
    nodes: [
      {
        id: "p1",
        type: "prompt",
        position: { x: 10.4, y: 20 },
        data: { kind: "prompt", label: "Text 1", prompt: "  write a still  ", text: "  hello  ", loading: true, error: "nope" },
      },
      {
        id: "i1",
        type: "image",
        position: { x: 200, y: 20 },
        data: {
          kind: "image",
          prompt: "still",
          modelTier: "basic",
          resolution: "1k",
          aspectRatio: "1:1",
          resultUrl: "blob:http://localhost/x",
          resultStoragePath: "u/photos/a.jpg",
          creationId: "c1",
          loading: true,
          uploading: false,
          error: "nope",
        },
      },
      {
        id: "s1",
        type: "sound",
        position: { x: 400, y: 20 },
        data: { kind: "sound", loading: true, error: "nope" },
      },
    ],
    edges: [
      {
        id: "e1",
        source: "p1",
        target: "i1",
        sourceHandle: "out",
        targetHandle: "prompt",
      },
      { id: "e-bad", source: "missing", target: "i1" },
    ],
    viewport: { x: 0, y: 0, zoom: 9 },
  });

  assert(saved.v === 1 && saved.nodes.length === 3 && saved.edges.length === 1, "orphan edges are dropped");
  assert(saved.edges[0]?.targetHandle === "in", "legacy prompt/image handles rewrite to the single input");
  const prompt = saved.nodes[0]?.data;
  assert(prompt?.kind === "prompt" && prompt.text === "hello", "prompt result is trimmed");
  assert(prompt?.kind === "prompt" && prompt.prompt === "write a still", "prompt instruction is persisted");
  assert(prompt?.kind === "prompt" && prompt.label === "Text 1", "node labels are persisted");
  assert(prompt?.kind === "prompt" && prompt.modelId === "gpt5", "text model falls back to GPT-5");
  const legacy = serializeCanvasGraph({
    nodes: [{ id: "old", type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text: "legacy copy" } }],
    edges: [],
  });
  const legacyData = legacy.nodes[0]?.data;
  assert(
    legacyData?.kind === "prompt" && legacyData.prompt === "legacy copy" && legacyData.text === "legacy copy",
    "old text-only nodes copy into the form instruction"
  );
  assert(prompt?.kind === "prompt" && !("loading" in prompt) && !("error" in prompt), "prompt ephemeral flags are stripped");
  const image = saved.nodes[1]?.data;
  assert(image?.kind === "image" && image.resultStoragePath === "u/photos/a.jpg", "storage path is kept");
  assert(image?.kind === "image" && !("resultUrl" in image), "blob and signed URLs are not persisted");
  assert(image?.kind === "image" && !("loading" in image) && !("error" in image), "ephemeral UI flags are stripped");
  const sound = saved.nodes[2]?.data;
  assert(sound?.kind === "sound" && !("loading" in sound), "sound is an empty asset");
  assert(sound?.kind === "sound" && sound.imported === false, "missing imported flags stay false");
  const importedGraph = serializeCanvasGraph({
    nodes: [
      {
        id: "i2",
        type: "image",
        position: { x: 0, y: 0 },
        data: {
          kind: "image",
          imported: true,
          resultStoragePath: "u/photos/b.jpg",
          prompt: "",
          modelTier: "basic",
          resolution: "1k",
          aspectRatio: "1:1",
        },
      },
    ],
    edges: [],
  });
  const imported = importedGraph.nodes[0]?.data;
  assert(imported?.kind === "image" && imported.imported === true, "imported library stills are persisted");
  assert(saved.viewport.zoom === 2, "viewport zoom is clamped");

  const parsed = parseCanvasGraph(saved);
  assert(parsed !== null && parsed.nodes[0]?.data.kind === "prompt", "a saved graph round-trips");
  assert(parseCanvasGraph({ v: 2, nodes: [], edges: [] }) === null, "unknown versions are rejected");
  assert(CANVAS_NODE_KINDS.length === 4, "saved kinds stay aligned with the live graph");
}

if (typeof require !== "undefined" && require.main === module) {
  canvasDocumentSelfCheck();
  console.log("canvasDocumentSelfCheck: ok");
}
