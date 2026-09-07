"use client";

import { Handle, Position } from "@xyflow/react";
import { CANVAS_HANDLES } from "@/lib/canvas-graph";
import { CANVAS_HANDLE_CLASS } from "./handles";

export default function CanvasTargetHandles() {
  return (
    <Handle
      type="target"
      position={Position.Left}
      id={CANVAS_HANDLES.in}
      className={CANVAS_HANDLE_CLASS}
      title="Input"
    />
  );
}
