import type { Edge, Node, Viewport } from "@xyflow/react";
import { nextCanvasNodeName, type CanvasNodeKind } from "@/lib/canvas-graph";
import { getVideoModel } from "@/lib/video-models";
import { getCanvasTextModel } from "@/lib/canvas-text-models";
import {
  serializeCanvasGraph,
  type SavedCanvasGraph,
} from "@/lib/canvas-document";
import { defaultDataForKind, type CanvasNodeData } from "./node-data";

export type CanvasFlowNode = Node<CanvasNodeData, CanvasNodeKind>;

export function graphFromFlow(
  nodes: CanvasFlowNode[],
  edges: Edge[],
  viewport: Viewport
): SavedCanvasGraph {
  return serializeCanvasGraph({
    nodes: nodes.map((node) => ({
      id: node.id,
      type: node.type,
      position: node.position,
      data: node.data as unknown as Record<string, unknown>,
    })),
    edges,
    viewport,
  });
}

export function flowFromGraph(graph: SavedCanvasGraph): {
  nodes: CanvasFlowNode[];
  edges: Edge[];
  viewport: Viewport;
} {
  const labels: string[] = [];
  return {
    nodes: graph.nodes.map((node) => {
      const data = {
        ...defaultDataForKind(node.type),
        ...node.data,
        resultUrl: null,
        loading: false,
        uploading: false,
        error: null,
      } as CanvasNodeData;
      if (!data.label.trim()) {
        data.label = nextCanvasNodeName(data.kind, labels);
      }
      labels.push(data.label);
      if (data.kind === "prompt") {
        data.modelId = getCanvasTextModel(data.modelId).id;
      }
      if (data.kind === "video") {
        const savedAudio = node.data.kind === "video" ? node.data.generateAudio : undefined;
        if (typeof savedAudio !== "boolean") {
          data.generateAudio = getVideoModel(data.modelId).defaultGenerateAudio;
        }
      }
      return {
        id: node.id,
        type: node.type,
        position: node.position,
        dragHandle: ".canvas-node-drag",
        data,
      };
    }),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      type: "canvas",
    })),
    viewport: graph.viewport,
  };
}
