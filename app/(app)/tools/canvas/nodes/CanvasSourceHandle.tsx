"use client";

import { useEffect, useRef, useState } from "react";
import { Handle, Position } from "@xyflow/react";
import { ImageIcon, Type, Video } from "lucide-react";
import {
  CANVAS_HANDLES,
  CANVAS_KIND_LABELS,
  nextCanvasKinds,
  type CanvasNodeKind,
} from "@/lib/canvas-graph";
import { useCanvasActions } from "../canvas-actions";
import { CANVAS_HANDLE_CLASS } from "./handles";

const ICONS: Partial<Record<CanvasNodeKind, typeof Type>> = {
  prompt: Type,
  image: ImageIcon,
  video: Video,
};

export default function CanvasSourceHandle({
  sourceId,
  sourceKind,
}: {
  sourceId: string;
  sourceKind: CanvasNodeKind;
}) {
  const { spawnFrom } = useCanvasActions();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const kinds = nextCanvasKinds(sourceKind);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    const timer = window.setTimeout(() => window.addEventListener("click", onClick), 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(timer);
      window.removeEventListener("click", onClick);
    };
  }, [open]);

  if (kinds.length === 0) return null;

  return (
    <>
      <Handle
        type="source"
        position={Position.Right}
        id={CANVAS_HANDLES.out}
        className={CANVAS_HANDLE_CLASS}
        title="Drag to connect, or click to add a node"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      />
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="nodrag nowheel nopan absolute right-0 top-1/2 z-50 translate-x-[calc(100%+10px)] -translate-y-1/2 rounded-xl border border-white/10 bg-N50/95 p-1 shadow-lg shadow-black/50 backdrop-blur-md"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {kinds.map((kind) => {
            const Icon = ICONS[kind] ?? Type;
            const label = CANVAS_KIND_LABELS[kind];
            return (
              <button
                key={kind}
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs font-medium text-text-primary transition-colors hover:bg-white/10"
                onClick={() => {
                  spawnFrom(sourceId, kind);
                  setOpen(false);
                }}
              >
                <Icon className="h-3.5 w-3.5 text-text-secondary" />
                {label}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
