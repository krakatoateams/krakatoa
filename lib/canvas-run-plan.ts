/**
 * Canvas chain run planner: which nodes a Run on `targetId` executes, in what
 * order, and which already-fresh results are reused.
 *
 * Pure — no React, no Supabase — so it stays runnable as a self-check
 * (`npx tsx lib/canvas-run-plan.ts`).
 *
 * Input order: a node's inputs follow edge order (the order wires were
 * connected; reconnecting keeps the slot), then @mentions in prompt order.
 * That order is part of the fingerprint, so rewiring marks the node stale.
 */
import { mentionedCanvasNodes, type CanvasGraphEdge, type CanvasGraphNode } from "./canvas-graph";
import { resolveIdempotentAttemptState } from "./idempotent-submit-state";

/** Most nodes one Run may execute. Skipped (fresh) nodes do not count. */
export const CANVAS_RUN_MAX_NODES = 20;
/** Nodes in flight at once per chain. */
export const CANVAS_RUN_CONCURRENCY = 3;

export type CanvasRunGraphNode = {
  id: string;
  data: CanvasGraphNode["data"] & {
    imported?: boolean;
    uploading?: boolean;
    runFingerprint?: string | null;
    lastRunError?: { message: string; fingerprint: string } | null;
    [key: string]: unknown;
  };
};

/** Settings each kind actually sends; output fields (text, results) are excluded. */
const OWN_KEYS: Record<string, string[]> = {
  prompt: ["prompt", "modelId"],
  image: ["prompt", "modelTier", "resolution", "quality", "aspectRatio"],
  video: ["prompt", "modelId", "duration", "resolution", "aspectRatio", "generateAudio"],
};

function fnv(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${input.length}:${(hash >>> 0).toString(36)}`;
}

/**
 * Upstream node ids, in input order: wires first, then mentioned nodes. Only
 * Text and Image outputs are read by any generator, so a wired Video is not a
 * dependency (running it would charge for output nobody uses).
 */
export function canvasRunDeps(
  nodeId: string,
  nodes: CanvasRunGraphNode[],
  edges: CanvasGraphEdge[]
): string[] {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return [];
  const out: string[] = [];
  const add = (id: string) => {
    if (id !== nodeId && !out.includes(id)) out.push(id);
  };
  for (const edge of edges) {
    if (edge.target !== nodeId) continue;
    const source = nodes.find((item) => item.id === edge.source);
    if (source && consumed(source)) add(source.id);
  }
  if (node.data.kind !== "sound") {
    for (const mentioned of mentionedCanvasNodes(node.data.prompt ?? "", nodes)) {
      if (consumed(mentioned)) add(mentioned.id);
    }
  }
  return out;
}

function consumed(node: { data: { kind: string } }): boolean {
  return node.data.kind === "prompt" || node.data.kind === "image";
}

export function canvasNodeHasOutput(node: CanvasRunGraphNode): boolean {
  if (node.data.kind === "prompt") return Boolean(node.data.text?.trim());
  return Boolean(
    node.data.resultStoragePath?.trim() || node.data.creationId?.trim() || node.data.resultUrl?.trim()
  );
}

/** What a downstream node receives from this one. Never a signed URL. */
function outputIdentity(node: CanvasRunGraphNode | undefined): string {
  if (!node) return "";
  if (node.data.kind === "prompt") return node.data.text?.trim() || node.data.prompt?.trim() || "";
  return node.data.resultStoragePath?.trim() || node.data.creationId?.trim() || "";
}

/** The node's own sent settings only; used to catch edits after the plan was confirmed. */
export function canvasNodeOwnFingerprint(node: CanvasRunGraphNode): string {
  const keys = OWN_KEYS[node.data.kind] ?? [];
  // Trimmed like the saved graph, so a reload never makes a fresh node look stale.
  const values = keys.map((key) => {
    const value = node.data[key];
    return typeof value === "string" ? value.trim() : value ?? null;
  });
  return fnv(JSON.stringify([node.data.kind, values]));
}

/** Own settings plus every upstream output identity, in input order. */
export function canvasNodeFingerprint(
  nodeId: string,
  nodes: CanvasRunGraphNode[],
  edges: CanvasGraphEdge[]
): string {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) return "";
  const deps = canvasRunDeps(nodeId, nodes, edges).map((id) => [
    id,
    outputIdentity(nodes.find((item) => item.id === id)),
  ]);
  return fnv(JSON.stringify([canvasNodeOwnFingerprint(node), deps]));
}

export type CanvasRunPlan =
  | {
      ok: true;
      /** Nodes to execute, grouped so every node's running inputs are in an earlier level. */
      levels: string[][];
      run: string[];
      skip: string[];
      deps: Record<string, string[]>;
      own: Record<string, string>;
    }
  | { ok: false; reason: "cycle"; nodeIds: string[] }
  | { ok: false; reason: "too-many"; count: number }
  | { ok: false; reason: "missing" };

export function planCanvasRun(input: {
  nodes: CanvasRunGraphNode[];
  edges: CanvasGraphEdge[];
  targetId: string;
  maxNodes?: number;
}): CanvasRunPlan {
  const { nodes, edges, targetId } = input;
  if (!nodes.some((node) => node.id === targetId)) return { ok: false, reason: "missing" };

  const deps: Record<string, string[]> = {};
  const order: string[] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  let cycle: string[] | null = null;

  const visit = (id: string) => {
    if (cycle) return;
    if (state.get(id) === "done") return;
    if (state.get(id) === "visiting") {
      cycle = stack.slice(stack.indexOf(id));
      return;
    }
    state.set(id, "visiting");
    stack.push(id);
    deps[id] = canvasRunDeps(id, nodes, edges);
    for (const dep of deps[id]) visit(dep);
    stack.pop();
    state.set(id, "done");
    order.push(id);
  };
  visit(targetId);
  if (cycle) return { ok: false, reason: "cycle", nodeIds: cycle };

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const runSet = new Set<string>();
  const level = new Map<string, number>();
  const skip: string[] = [];
  const own: Record<string, string> = {};
  for (const id of order) {
    const node = byId.get(id)!;
    const upstreamRuns = deps[id].filter((dep) => runSet.has(dep));
    const current = canvasNodeFingerprint(id, nodes, edges);
    // The latest attempt with these exact inputs failed, so a Run retries it.
    const failedHere = node.data.lastRunError?.fingerprint === current;
    const fresh =
      canvasNodeHasOutput(node) &&
      !failedHere &&
      (!node.data.runFingerprint || node.data.runFingerprint === current);
    // Imported media is a source; legacy results without a fingerprint are reused, never re-charged.
    if (node.data.imported || node.data.kind === "sound" || (upstreamRuns.length === 0 && fresh)) {
      skip.push(id);
      continue;
    }
    runSet.add(id);
    own[id] = canvasNodeOwnFingerprint(node);
    level.set(id, upstreamRuns.reduce((max, dep) => Math.max(max, level.get(dep)! + 1), 0));
  }

  const run = order.filter((id) => runSet.has(id));
  const max = input.maxNodes ?? CANVAS_RUN_MAX_NODES;
  if (run.length > max) return { ok: false, reason: "too-many", count: run.length };

  const levels: string[][] = [];
  for (const id of run) (levels[level.get(id)!] ??= []).push(id);
  return { ok: true, levels, run, skip, deps, own };
}

/** Planned nodes that (transitively) depend on any of `failedIds`. */
export function canvasRunDownstream(
  plan: Extract<CanvasRunPlan, { ok: true }>,
  failedIds: Iterable<string>
): string[] {
  const bad = new Set(failedIds);
  const out: string[] = [];
  for (const id of plan.run) {
    if (bad.has(id)) continue;
    if (plan.deps[id].some((dep) => bad.has(dep))) {
      bad.add(id);
      out.push(id);
    }
  }
  return out;
}

export function canvasRunEstimate(
  plan: Extract<CanvasRunPlan, { ok: true }>,
  costOf: (id: string) => number
): number {
  return plan.run.reduce((sum, id) => sum + costOf(id), 0);
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`canvas-run-plan self-check: ${msg}`);
}

export function canvasRunPlanSelfCheck(): void {
  const text = (id: string, extra: Partial<CanvasRunGraphNode["data"]> = {}): CanvasRunGraphNode => ({
    id,
    data: { kind: "prompt", label: id, prompt: `write ${id}`, modelId: "gpt5", text: "", ...extra },
  });
  const image = (id: string, extra: Partial<CanvasRunGraphNode["data"]> = {}): CanvasRunGraphNode => ({
    id,
    data: { kind: "image", label: id, prompt: "", modelTier: "basic", resolution: "1k", aspectRatio: "1:1", ...extra },
  });
  const video = (id: string, extra: Partial<CanvasRunGraphNode["data"]> = {}): CanvasRunGraphNode => ({
    id,
    data: { kind: "video", label: id, prompt: "", modelId: "m", duration: 5, resolution: "720p", aspectRatio: "16:9", ...extra },
  });
  const wire = (source: string, target: string): CanvasGraphEdge => ({
    id: `${source}-${target}`,
    source,
    target,
    targetHandle: "in",
  });

  // The issue's example: 3 Text -> 3 Image -> storyboard Image -> Video.
  const nodes = [
    text("t1"), text("t2"), text("t3"),
    image("i1"), image("i2"), image("i3"),
    image("sb"), video("v"),
  ];
  const edges = [
    wire("t1", "i1"), wire("t2", "i2"), wire("t3", "i3"),
    wire("i1", "sb"), wire("i2", "sb"), wire("i3", "sb"),
    wire("sb", "v"),
  ];
  const plan = planCanvasRun({ nodes, edges, targetId: "v" });
  assert(plan.ok, "example graph plans");
  if (!plan.ok) return;
  assert(
    JSON.stringify(plan.levels) === JSON.stringify([["t1", "t2", "t3"], ["i1", "i2", "i3"], ["sb"], ["v"]]),
    `example graph runs in four levels, got ${JSON.stringify(plan.levels)}`
  );
  const prices: Record<string, number> = { t1: 1, t2: 1, t3: 1, i1: 4, i2: 4, i3: 4, sb: 6, v: 30 };
  assert(canvasRunEstimate(plan, (id) => prices[id]) === 51, "estimate sums every node that runs");

  // Mark everything done with recorded fingerprints: a re-run executes nothing.
  const done = nodes.map((node) =>
    node.data.kind === "prompt"
      ? { ...node, data: { ...node.data, text: `out ${node.id}` } }
      : { ...node, data: { ...node.data, resultStoragePath: `u/${node.id}.png` } }
  );
  for (const node of done) node.data.runFingerprint = canvasNodeFingerprint(node.id, done, edges);
  const fresh = planCanvasRun({ nodes: done, edges, targetId: "v" });
  assert(fresh.ok && fresh.run.length === 0 && fresh.skip.length === 8, "unchanged chain reuses every result");

  // Editing one upstream prompt re-runs it and only its downstream path.
  const edited = done.map((node) =>
    node.id === "t2" ? { ...node, data: { ...node.data, prompt: "write something else" } } : node
  );
  const stale = planCanvasRun({ nodes: edited, edges, targetId: "v" });
  assert(stale.ok && stale.run.join() === "t2,i2,sb,v", "an edit re-runs that node and its downstream only");
  if (stale.ok) {
    assert(canvasRunEstimate(stale, (id) => prices[id]) === 41, "skipped nodes cost nothing");
  }

  // Rewiring order changes the fingerprint (input order is part of it).
  const reordered = [edges[0], edges[1], edges[2], edges[4], edges[3], edges[5], edges[6]];
  const rewired = planCanvasRun({ nodes: done, edges: reordered, targetId: "v" });
  assert(rewired.ok && rewired.run.join() === "sb,v", "reordering inputs marks the target stale");

  // A node whose last attempt failed with these inputs is retried even if an older result exists.
  const retried = done.map((node) =>
    node.id === "v"
      ? { ...node, data: { ...node.data, lastRunError: { message: "Boom.", fingerprint: canvasNodeFingerprint("v", done, edges) } } }
      : node
  );
  const retry = planCanvasRun({ nodes: retried, edges, targetId: "v" });
  assert(retry.ok && retry.run.join() === "v", "a failed node is retried on its own");

  // Legacy results (no fingerprint) and imported media are reused.
  const legacy = planCanvasRun({
    nodes: [image("a", { resultStoragePath: "u/a.png" }), video("b", { resultStoragePath: "u/b.mp4" })],
    edges: [wire("a", "b")],
    targetId: "b",
  });
  assert(legacy.ok && legacy.run.length === 0, "results saved before fingerprints are reused");
  const imported = planCanvasRun({
    nodes: [image("a", { imported: true }), video("b")],
    edges: [wire("a", "b")],
    targetId: "b",
  });
  assert(imported.ok && imported.run.join() === "b" && imported.skip.join() === "a", "imported media never runs");

  // Diamond: a shared upstream node is planned once.
  const diamond = planCanvasRun({
    nodes: [text("t"), image("l"), image("r"), video("v")],
    edges: [wire("t", "l"), wire("t", "r"), wire("l", "v"), wire("r", "v")],
    targetId: "v",
  });
  assert(
    diamond.ok && diamond.run.filter((id) => id === "t").length === 1 && diamond.levels.length === 3,
    "a diamond runs its shared node once"
  );

  // A wired Video feeds nothing, so it is never run on a downstream node's behalf.
  const videoSource = planCanvasRun({
    nodes: [video("v0", { prompt: "waves" }), image("i", { prompt: "a boat" })],
    edges: [wire("v0", "i")],
    targetId: "i",
  });
  assert(videoSource.ok && videoSource.run.join() === "i" && videoSource.skip.length === 0, "a wired video is not a dependency");

  // @mentions are dependencies too.
  const mention = planCanvasRun({
    nodes: [text("Text 1"), image("i", { prompt: "draw @Text 1" })],
    edges: [],
    targetId: "i",
  });
  assert(mention.ok && mention.run.join() === "Text 1,i", "a mentioned Text node runs first");

  // Cycles are reported before anything runs.
  const cyclic = planCanvasRun({
    nodes: [image("a"), image("b"), image("c")],
    edges: [wire("a", "b"), wire("b", "c"), wire("c", "a")],
    targetId: "c",
  });
  assert(!cyclic.ok && cyclic.reason === "cycle" && cyclic.nodeIds.length === 3, "a cycle is rejected with its nodes");

  // Cap on nodes that actually run.
  const many = Array.from({ length: 5 }, (_, index) => text(`p${index}`));
  const capped = planCanvasRun({
    nodes: [...many, image("x")],
    edges: many.map((node) => wire(node.id, "x")),
    targetId: "x",
    maxNodes: 5,
  });
  assert(!capped.ok && capped.reason === "too-many" && capped.count === 6, "chains over the cap are refused");

  // Failure blocks everything downstream, and only that.
  assert(canvasRunDownstream(plan, ["i2"]).join() === "sb,v", "a failure blocks its downstream path");
  assert(canvasRunDownstream(plan, ["t1"]).join() === "i1,sb,v", "blocking is transitive");

  // Per-node idempotency keys: an identical retry reuses the key; changed inputs rotate it.
  let n = 0;
  const mint = () => `k${(n += 1)}`;
  const first = resolveIdempotentAttemptState("sig-a", null, mint, mint);
  assert(resolveIdempotentAttemptState("sig-a", first, mint, mint).key === first.key, "identical retry keeps the key");
  assert(resolveIdempotentAttemptState("sig-b", first, mint, mint).key !== first.key, "changed inputs rotate the key");
}

if (typeof require !== "undefined" && require.main === module) {
  canvasRunPlanSelfCheck();
  console.log("canvasRunPlanSelfCheck: ok");
}
