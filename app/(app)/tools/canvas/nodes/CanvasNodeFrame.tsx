"use client";

import { useNodeId, useStore } from "@xyflow/react";
import { AlertCircle, Loader2, Play, RotateCcw, X } from "lucide-react";
import type { CanvasGraphEdge, CanvasNodeKind } from "@/lib/canvas-graph";
import { canvasNodeFingerprint, type CanvasRunGraphNode } from "@/lib/canvas-run-plan";
import { useCanvasRun, type CanvasRunStatus } from "../canvas-run";
import CanvasSourceHandle from "./CanvasSourceHandle";
import CanvasTargetHandles from "./CanvasTargetHandles";

const CHIP_LABELS: Partial<Record<CanvasRunStatus["state"], string>> = {
  queued: "Queued",
  running: "Running",
  done: "Done",
  skipped: "Reused",
  blocked: "Blocked",
};

export default function CanvasNodeFrame({
  kind,
  title,
  selected,
  onRemove,
  sourceId,
  asset,
  form,
}: {
  kind: CanvasNodeKind;
  title: string;
  selected?: boolean;
  onRemove?: () => void;
  /** When set, this node can spawn/connect from its output. */
  sourceId?: string;
  asset: React.ReactNode;
  form?: React.ReactNode;
}) {
  const connectable = kind !== "sound";
  const id = useNodeId() ?? "";
  const nodes = useStore((s) => s.nodes) as unknown as CanvasRunGraphNode[];
  const edges = useStore((s) => s.edges) as unknown as CanvasGraphEdge[];
  const { canRun, active, statuses, start } = useCanvasRun();
  const node = nodes.find((item) => item.id === id);
  const status = statuses[id];

  // A saved failure only applies while the inputs it failed with are unchanged.
  const saved = node?.data.lastRunError as { message?: string; fingerprint?: string } | undefined;
  const savedFailure =
    saved?.message && saved.fingerprint === canvasNodeFingerprint(id, nodes, edges) ? saved.message : null;
  const failure = status?.state === "failed" ? status.reason : status ? null : savedFailure;
  const blocked = status?.state === "blocked" ? status.reason : null;
  const runnable = canRun && kind !== "sound" && !node?.data.imported;
  const inChain = status?.state === "queued" || status?.state === "running";

  const border = failure
    ? "border-stroke-alert"
    : blocked
      ? "border-stroke-analytic/70"
      : selected
        ? "border-white/30"
        : "border-white/10";

  return (
    <div className="relative w-[340px]">
      {connectable && <CanvasTargetHandles />}
      {sourceId && <CanvasSourceHandle sourceId={sourceId} sourceKind={kind} />}
      <div className={`rounded-2xl border bg-N50 shadow-lg shadow-black/40 ${border}`}>
        <div className="canvas-node-drag flex cursor-grab items-center justify-between gap-2 border-b border-white/10 px-3 py-2 active:cursor-grabbing">
          <span className="truncate text-[11px] font-semibold tracking-wide text-text-secondary">
            {title}
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {status && CHIP_LABELS[status.state] ? (
              <span
                className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  status.state === "blocked" ? "bg-bg-high-yellow/15 text-text-analytic" : "bg-white/10 text-text-secondary"
                }`}
              >
                {status.state === "running" ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
                {CHIP_LABELS[status.state]}
              </span>
            ) : null}
            {runnable && !inChain ? (
              <button
                type="button"
                title="Run this node and everything feeding into it"
                aria-label={`Run ${title} and everything feeding into it`}
                disabled={active}
                className="nodrag flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
                onClick={(event) => {
                  event.stopPropagation();
                  start(id);
                }}
              >
                <Play className="h-3 w-3" aria-hidden />
                Run
              </button>
            ) : null}
            {onRemove && (
              <button
                type="button"
                title={inChain ? "This node is part of a running chain" : "Delete node"}
                aria-label="Delete node"
                disabled={inChain}
                className="nodrag rounded-md p-0.5 text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-text-primary disabled:pointer-events-none disabled:opacity-40"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove();
                }}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {failure ? (
          <div role="alert" className="flex items-start gap-2 border-b border-white/10 px-3 py-2 text-[11px] text-text-alert">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="sr-only">Run failed: </span>
              {failure}
            </span>
            {runnable ? (
              <button
                type="button"
                disabled={active}
                className="nodrag flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-text-primary hover:bg-white/10 disabled:opacity-40"
                onClick={(event) => {
                  event.stopPropagation();
                  start(id);
                }}
              >
                <RotateCcw className="h-3 w-3" aria-hidden />
                Retry
              </button>
            ) : null}
          </div>
        ) : blocked ? (
          <p className="border-b border-white/10 px-3 py-2 text-[11px] text-text-analytic">{blocked}</p>
        ) : null}
        <div className="relative p-3">{asset}</div>
      </div>
      {selected && form ? (
        <div className="absolute left-0 top-full z-20 mt-2 w-full">{form}</div>
      ) : null}
    </div>
  );
}
