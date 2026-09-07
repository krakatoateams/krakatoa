"use client";

import { useCallback } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  useStore,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";

type WireLink = "none" | "in" | "out" | "both";

export default function CanvasEdge({
  id,
  source,
  target,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  selected,
  style,
  markerEnd,
}: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const link = useStore(
    useCallback(
      (state): WireLink => {
        const sourceSelected = state.nodes.some((node) => node.selected && node.id === source);
        const targetSelected = state.nodes.some((node) => node.selected && node.id === target);
        if (sourceSelected && targetSelected) return "both";
        if (sourceSelected) return "out";
        if (targetSelected) return "in";
        return "none";
      },
      [source, target]
    )
  );
  const active = selected || link !== "none";
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const gradientId = `kk-wire-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const hotAtTarget = link === "in";

  const markerId = `${gradientId}-end`;

  return (
    <>
      {active && (
        <defs>
          <linearGradient
            id={gradientId}
            gradientUnits="userSpaceOnUse"
            x1={sourceX}
            y1={sourceY}
            x2={targetX}
            y2={targetY}
          >
            <stop offset="0%" stopColor={hotAtTarget ? "#FFBC8D" : "#F26522"} />
            <stop offset="52%" stopColor="#FF7B33" />
            <stop offset="100%" stopColor={hotAtTarget ? "#F26522" : "#FFBC8D"} />
          </linearGradient>
          <marker
            id={markerId}
            markerWidth="16"
            markerHeight="16"
            viewBox="0 0 16 16"
            orient="auto"
            refX="14"
            refY="8"
          >
            <path d="M0 1 L15 8 L0 15 z" fill={hotAtTarget ? "#F26522" : "#FF7B33"} />
          </marker>
        </defs>
      )}
      {active && (
        <path
          d={edgePath}
          fill="none"
          stroke="rgba(242, 101, 34, 0.28)"
          strokeWidth={8}
          className="kk-canvas-wire-glow"
        />
      )}
      <BaseEdge
        id={id}
        path={edgePath}
        markerEnd={active ? `url(#${markerId})` : markerEnd}
        interactionWidth={28}
        style={{
          ...style,
          stroke: active ? `url(#${gradientId})` : "rgba(255,255,255,0.32)",
          strokeWidth: active ? 2.6 : 1.6,
        }}
      />
      {active && (
        <path
          d={edgePath}
          fill="none"
          stroke="rgba(255, 226, 201, 0.95)"
          strokeWidth={2.4}
          className="kk-canvas-wire-run"
        />
      )}
      {selected && (
        <EdgeLabelRenderer>
          <button
            type="button"
            title="Disconnect"
            aria-label="Disconnect wire"
            className="nodrag nopan pointer-events-auto absolute flex h-6 w-6 items-center justify-center rounded-full border border-white/20 bg-N50 text-text-primary shadow-lg shadow-black/40 hover:bg-error/20 hover:text-error"
            style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}
            onClick={(event) => {
              event.stopPropagation();
              void deleteElements({ edges: [{ id }] });
            }}
          >
            <X className="h-3 w-3" />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
