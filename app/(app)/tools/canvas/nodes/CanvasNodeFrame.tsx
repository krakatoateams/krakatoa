"use client";

import { X } from "lucide-react";
import type { CanvasNodeKind } from "@/lib/canvas-graph";
import CanvasSourceHandle from "./CanvasSourceHandle";
import CanvasTargetHandles from "./CanvasTargetHandles";

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
  return (
    <div className="relative w-[340px]">
      {connectable && <CanvasTargetHandles />}
      {sourceId && <CanvasSourceHandle sourceId={sourceId} sourceKind={kind} />}
      <div
        className={`rounded-2xl border bg-N50 shadow-lg shadow-black/40 ${
          selected ? "border-white/30" : "border-white/10"
        }`}
      >
        <div className="canvas-node-drag flex cursor-grab items-center justify-between border-b border-white/10 px-3 py-2 active:cursor-grabbing">
          <span className="text-[11px] font-semibold tracking-wide text-text-secondary">
            {title}
          </span>
          {onRemove && (
            <button
              type="button"
              title="Delete node"
              aria-label="Delete node"
              className="nodrag rounded-md p-0.5 text-icon-low-emphasis transition-colors hover:bg-white/10 hover:text-text-primary"
              onClick={(event) => {
                event.stopPropagation();
                onRemove();
              }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="relative p-3">{asset}</div>
      </div>
      {selected && form ? (
        <div className="absolute left-0 top-full z-20 mt-2 w-full">{form}</div>
      ) : null}
    </div>
  );
}
