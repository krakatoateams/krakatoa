/**
 * Canvas graph types + connection rules.
 *
 * Pure — no React, no Supabase — so the wiring stays runnable as a self-check
 * (`npx tsx lib/canvas-graph.ts`).
 */

export const CANVAS_NODE_KINDS = ["prompt", "image", "video", "sound"] as const;
export type CanvasNodeKind = (typeof CANVAS_NODE_KINDS)[number];

/** UI labels. Saved graphs keep `kind: "prompt"` for the Text node. */
export const CANVAS_KIND_LABELS: Record<CanvasNodeKind, string> = {
  prompt: "Text",
  image: "Image",
  video: "Video",
  sound: "Sound",
};

export const CANVAS_HANDLES = {
  in: "in",
  out: "out",
} as const;

export type CanvasHandleId = (typeof CANVAS_HANDLES)[keyof typeof CANVAS_HANDLES];

const LEGACY_TARGET_HANDLES = new Set(["prompt", "image", CANVAS_HANDLES.in]);

export type CanvasGraphNode = {
  id: string;
  data: {
    kind: CanvasNodeKind;
    /** Generated text asset (Text nodes). */
    text?: string;
    /** Form instruction (Text / Image / Video). */
    prompt?: string;
    /** Display name, e.g. "Text 1". */
    label?: string;
    resultUrl?: string | null;
    resultStoragePath?: string | null;
    creationId?: string | null;
  };
};

export type CanvasGraphEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

/**
 * Allowed wiring (one input port per node):
 *   prompt.out → image | video | prompt
 *   image.out  → image | video | prompt
 * Video and sound cannot feed anything. Sound cannot be a target.
 */
export function canConnectCanvas(params: {
  sourceKind: CanvasNodeKind;
  targetKind: CanvasNodeKind;
  targetHandle?: string | null;
  sourceId?: string;
  targetId?: string;
}): boolean {
  const { sourceKind, targetKind, targetHandle, sourceId, targetId } = params;
  if (sourceId && targetId && sourceId === targetId) return false;
  if (targetHandle && !LEGACY_TARGET_HANDLES.has(targetHandle)) return false;
  if (targetKind === "sound" || sourceKind === "sound" || sourceKind === "video") return false;
  if (sourceKind !== "prompt" && sourceKind !== "image") return false;
  return targetKind === "image" || targetKind === "video" || targetKind === "prompt";
}

/** Kinds the output-handle spawn menu may offer for this source. */
export function nextCanvasKinds(sourceKind: CanvasNodeKind): CanvasNodeKind[] {
  if (sourceKind === "prompt" || sourceKind === "image") {
    return ["prompt", "image", "video"];
  }
  return [];
}

/** Display name shown on the node and used as an @-mention token. */
export function canvasNodeName(kind: CanvasNodeKind, index: number): string {
  return `${CANVAS_KIND_LABELS[kind]} ${index}`;
}

export function nextCanvasNodeName(
  kind: CanvasNodeKind,
  names: Array<string | undefined | null>
): string {
  const prefix = `${CANVAS_KIND_LABELS[kind]} `;
  let max = 0;
  for (const name of names) {
    if (!name || !name.startsWith(prefix)) continue;
    const n = Number(name.slice(prefix.length));
    if (Number.isInteger(n) && n > max) max = n;
  }
  return canvasNodeName(kind, max + 1);
}

function escapeCanvasLabel(label: string): string {
  return label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function promptMentionsLabel(prompt: string, label: string): boolean {
  return new RegExp(`@${escapeCanvasLabel(label)}(?=$|\\s|[.,!?;:])`).test(prompt);
}

export function mentionedCanvasNodes(
  prompt: string,
  nodes: CanvasGraphNode[]
): CanvasGraphNode[] {
  if (!prompt.includes("@")) return [];
  return nodes.filter((node) => {
    const label = node.data.label?.trim();
    return Boolean(label) && promptMentionsLabel(prompt, label!);
  });
}

/** Expand @Text 1 tokens to that node's written copy. */
export function resolveCanvasMentionPrompt(
  prompt: string,
  nodes: CanvasGraphNode[]
): string {
  const mentioned = mentionedCanvasNodes(prompt, nodes)
    .filter((node) => node.data.kind === "prompt")
    .sort((a, b) => (b.data.label?.length ?? 0) - (a.data.label?.length ?? 0));
  let out = prompt;
  for (const node of mentioned) {
    const label = node.data.label?.trim();
    if (!label) continue;
    const body = node.data.text?.trim() || node.data.prompt?.trim();
    if (!body) continue;
    out = out.replace(
      new RegExp(`@${escapeCanvasLabel(label)}(?=$|\\s|[.,!?;:])`, "g"),
      () => body
    );
  }
  return out;
}

export function mentionedCanvasImages(
  prompt: string,
  nodes: CanvasGraphNode[]
): CanvasUpstreamImage[] {
  const images: CanvasUpstreamImage[] = [];
  for (const node of mentionedCanvasNodes(prompt, nodes)) {
    if (node.data.kind !== "image") continue;
    const resultStoragePath = node.data.resultStoragePath?.trim() || null;
    const resultUrl = node.data.resultUrl?.trim() || null;
    const creationId = node.data.creationId?.trim() || null;
    if (resultStoragePath || resultUrl || creationId) {
      images.push({ id: node.id, resultStoragePath, resultUrl, creationId });
    }
  }
  return images;
}

export function mergeCanvasImages(
  ...groups: CanvasUpstreamImage[][]
): CanvasUpstreamImage[] {
  const seen = new Set<string>();
  const out: CanvasUpstreamImage[] = [];
  for (const group of groups) {
    for (const image of group) {
      if (seen.has(image.id)) continue;
      seen.add(image.id);
      out.push(image);
    }
  }
  return out;
}

/** Gemini / Nano Banana stay sane past this many stills. */
export const MAX_CANVAS_REF_IMAGES = 8;

export function usableCanvasRefImages(images: CanvasUpstreamImage[]): CanvasUpstreamImage[] {
  return images.filter(
    (image) => image.resultStoragePath || image.resultUrl || image.creationId
  );
}

export function canvasRefStoragePaths(
  images: CanvasUpstreamImage[],
  max = MAX_CANVAS_REF_IMAGES
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const image of images) {
    const path = image.resultStoragePath?.trim();
    if (!path || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
    if (paths.length >= max) break;
  }
  return paths;
}

export function inferCanvasTargetHandle(sourceKind: CanvasNodeKind): "in" | null {
  if (sourceKind === "prompt" || sourceKind === "image") return CANVAS_HANDLES.in;
  return null;
}

export function isDuplicateCanvasConnection(
  edges: { id?: string; source: string; target: string }[],
  params: { source?: string | null; target?: string | null; id?: string }
): boolean {
  if (!params.source || !params.target) return false;
  return edges.some(
    (edge) =>
      edge.source === params.source &&
      edge.target === params.target &&
      edge.id !== params.id
  );
}

export type CanvasUpstreamImage = {
  id: string;
  resultStoragePath: string | null;
  resultUrl: string | null;
  creationId: string | null;
};

export type CanvasUpstreamPrompt = {
  id: string;
  text: string;
};

export function findUpstreamPrompts(
  nodes: CanvasGraphNode[],
  edges: CanvasGraphEdge[],
  targetId: string
): CanvasUpstreamPrompt[] {
  const prompts: CanvasUpstreamPrompt[] = [];
  for (const edge of edges) {
    if (edge.target !== targetId) continue;
    const source = nodes.find((n) => n.id === edge.source);
    if (source?.data.kind !== "prompt") continue;
    const result = source.data.text?.trim() ?? "";
    const instruction = source.data.prompt?.trim() ?? "";
    prompts.push({ id: source.id, text: result || instruction });
  }
  return prompts;
}

export function findUpstreamPromptTexts(
  nodes: CanvasGraphNode[],
  edges: CanvasGraphEdge[],
  targetId: string
): string[] {
  return findUpstreamPrompts(nodes, edges, targetId)
    .map((prompt) => prompt.text)
    .filter(Boolean);
}

export function findUpstreamImages(
  nodes: CanvasGraphNode[],
  edges: CanvasGraphEdge[],
  targetId: string
): CanvasUpstreamImage[] {
  const images: CanvasUpstreamImage[] = [];
  for (const edge of edges) {
    if (edge.target !== targetId) continue;
    const source = nodes.find((n) => n.id === edge.source);
    if (source?.data.kind !== "image") continue;
    const resultStoragePath = source.data.resultStoragePath?.trim() || null;
    const resultUrl = source.data.resultUrl?.trim() || null;
    const creationId = source.data.creationId?.trim() || null;
    images.push({ id: source.id, resultStoragePath, resultUrl, creationId });
  }
  return images;
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`canvas-graph self-check: ${msg}`);
}

export function canvasGraphSelfCheck(): void {
  assert(
    canConnectCanvas({ sourceKind: "prompt", targetKind: "image", targetHandle: "in" }),
    "prompt can feed an image node"
  );
  assert(
    canConnectCanvas({ sourceKind: "prompt", targetKind: "video", targetHandle: "in" }),
    "prompt can feed a video node"
  );
  assert(
    canConnectCanvas({ sourceKind: "prompt", targetKind: "image", targetHandle: "image" }),
    "legacy image-handle wires still connect"
  );
  assert(
    canConnectCanvas({ sourceKind: "prompt", targetKind: "prompt", targetHandle: "in" }),
    "prompt can chain into another text node"
  );
  assert(
    canConnectCanvas({ sourceKind: "image", targetKind: "prompt", targetHandle: "in" }),
    "image can feed a text node as vision context"
  );
  assert(
    canConnectCanvas({ sourceKind: "image", targetKind: "video", targetHandle: "in" }),
    "image can feed a video start frame"
  );
  assert(
    canConnectCanvas({ sourceKind: "image", targetKind: "image", targetHandle: "in" }),
    "image can feed another image as reference"
  );
  assert(
    !canConnectCanvas({ sourceKind: "video", targetKind: "image", targetHandle: "in" }),
    "video cannot feed an image"
  );
  assert(
    !canConnectCanvas({ sourceKind: "video", targetKind: "video" }),
    "video cannot feed video"
  );
  assert(
    !canConnectCanvas({
      sourceKind: "prompt",
      targetKind: "image",
      sourceId: "a",
      targetId: "a",
    }),
    "a node cannot connect to itself"
  );

  const nodes: CanvasGraphNode[] = [
    { id: "p1", data: { kind: "prompt", text: " a cinematic still " } },
    { id: "i1", data: { kind: "image", prompt: "local", resultStoragePath: "u/photos/a.jpg", resultUrl: "https://example.com/a.jpg", creationId: "c1" } },
    { id: "v1", data: { kind: "video", prompt: "" } },
  ];
  const edges: CanvasGraphEdge[] = [
    { id: "e1", source: "p1", target: "i1", targetHandle: "in" },
    { id: "e2", source: "i1", target: "v1", targetHandle: "in" },
  ];
  assert(findUpstreamPromptTexts(nodes, edges, "i1")[0] === "a cinematic still", "prompt text is trimmed from upstream");
  assert(findUpstreamPromptTexts(nodes, edges, "v1").length === 0, "video with no prompt edge has no upstream text");
  const up = findUpstreamImages(nodes, edges, "v1");
  assert(
    up[0]?.id === "i1" && up[0].resultStoragePath === "u/photos/a.jpg" && up[0].creationId === "c1",
    "video reads the connected image result and library creation id"
  );

  assert(inferCanvasTargetHandle("prompt") === "in", "prompt lands on the single input");
  assert(inferCanvasTargetHandle("image") === "in", "image lands on the single input");
  assert(inferCanvasTargetHandle("video") === null, "video cannot start a wire");
  assert(
    !isDuplicateCanvasConnection(edges, { source: "p1", target: "v1" }),
    "a new source-target pair is not a duplicate"
  );
  assert(
    isDuplicateCanvasConnection(edges, { source: "p1", target: "i1" }),
    "the same source cannot wire twice into the same target"
  );
  assert(
    !isDuplicateCanvasConnection(edges, { source: "p1", target: "i1", id: "e1" }),
    "reconnecting the same edge is not a duplicate of itself"
  );

  const multiNodes: CanvasGraphNode[] = [
    { id: "p1", data: { kind: "prompt", text: "first" } },
    { id: "p2", data: { kind: "prompt", text: "second" } },
    { id: "i1", data: { kind: "image", resultStoragePath: "u/photos/a.jpg", resultUrl: "https://example.com/a.jpg" } },
    { id: "i2", data: { kind: "image", resultStoragePath: "u/photos/b.jpg", resultUrl: "https://example.com/b.jpg" } },
    { id: "t1", data: { kind: "image", prompt: "" } },
  ];
  const multiEdges: CanvasGraphEdge[] = [
    { id: "e1", source: "p1", target: "t1", targetHandle: "in" },
    { id: "e2", source: "p2", target: "t1", targetHandle: "in" },
    { id: "e3", source: "i1", target: "t1", targetHandle: "in" },
    { id: "e4", source: "i2", target: "t1", targetHandle: "in" },
  ];
  assert(
    findUpstreamPromptTexts(multiNodes, multiEdges, "t1").join("|") === "first|second",
    "multiple text nodes all feed the target"
  );
  assert(findUpstreamImages(multiNodes, multiEdges, "t1").length === 2, "multiple image nodes all feed the target");

  const chainNodes: CanvasGraphNode[] = [
    { id: "p1", data: { kind: "prompt", text: "first draft" } },
    { id: "p2", data: { kind: "prompt", text: "rewrite this" } },
    { id: "i2", data: { kind: "image", resultStoragePath: "u/photos/b.jpg", resultUrl: "https://example.com/b.jpg" } },
  ];
  const chainEdges: CanvasGraphEdge[] = [
    { id: "e-pp", source: "p1", target: "p2", targetHandle: "in" },
    { id: "e-ip", source: "i2", target: "p2", targetHandle: "in" },
  ];
  assert(findUpstreamPromptTexts(chainNodes, chainEdges, "p2")[0] === "first draft", "chained text reads upstream copy");
  assert(findUpstreamImages(chainNodes, chainEdges, "p2")[0]?.id === "i2", "text node reads a connected image");

  for (const source of CANVAS_NODE_KINDS) {
    for (const next of nextCanvasKinds(source)) {
      const handle = inferCanvasTargetHandle(source);
      assert(handle !== null, `${source} spawn menu has a target handle`);
      assert(
        canConnectCanvas({ sourceKind: source, targetKind: next, targetHandle: handle }),
        `spawn ${source} → ${next} is legal`
      );
    }
  }
  assert(nextCanvasKinds("video").length === 0, "video has no spawn menu");
  assert(nextCanvasKinds("sound").length === 0, "sound has no spawn menu");
  assert(
    !canConnectCanvas({ sourceKind: "prompt", targetKind: "sound" }),
    "sound cannot be a wiring target"
  );
  assert(
    !canConnectCanvas({ sourceKind: "sound", targetKind: "image" }),
    "sound cannot feed anything"
  );
  assert(CANVAS_KIND_LABELS.prompt === "Text", "prompt nodes are labeled Text in the UI");
  assert(CANVAS_KIND_LABELS.sound === "Sound", "sound nodes are labeled Sound");
  assert(nextCanvasNodeName("prompt", []) === "Text 1", "the first text node is Text 1");
  assert(nextCanvasNodeName("prompt", ["Text 1", "Image 1"]) === "Text 2", "text numbers are per kind");
  assert(
    resolveCanvasMentionPrompt("use @Text 1", [
      { id: "p1", data: { kind: "prompt", label: "Text 1", text: "a red bicycle" } },
    ]) === "use a red bicycle",
    "@Text 1 expands to the node's copy"
  );
  assert(
    mentionedCanvasNodes("use @Text 10", [
      { id: "p1", data: { kind: "prompt", label: "Text 1", text: "one" } },
      { id: "p10", data: { kind: "prompt", label: "Text 10", text: "ten" } },
    ]).map((node) => node.id).join() === "p10",
    "@Text 10 does not also match Text 1"
  );
  assert(
    mentionedCanvasImages("see @Image 1", [
      {
        id: "i1",
        data: {
          kind: "image",
          label: "Image 1",
          resultStoragePath: "u/photos/a.jpg",
          resultUrl: "https://example.com/a.jpg",
        },
      },
    ])[0]?.id === "i1",
    "@Image 1 resolves to that node's still"
  );
  assert(
    canvasRefStoragePaths([
      { id: "a", resultStoragePath: "u/a.png", resultUrl: null, creationId: null },
      { id: "b", resultStoragePath: "u/b.png", resultUrl: null, creationId: null },
      { id: "c", resultStoragePath: "u/a.png", resultUrl: null, creationId: null },
    ]).join() === "u/a.png,u/b.png",
    "ref paths keep order and drop duplicates"
  );
  assert(
    usableCanvasRefImages([
      { id: "empty", resultStoragePath: null, resultUrl: null, creationId: null },
      { id: "ok", resultStoragePath: "u/a.png", resultUrl: null, creationId: null },
    ]).map((image) => image.id).join() === "ok",
    "empty image nodes are not sent as refs"
  );
}

if (typeof require !== "undefined" && require.main === module) {
  canvasGraphSelfCheck();
  console.log("canvasGraphSelfCheck: ok");
}
