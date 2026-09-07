"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Trash2 } from "lucide-react";
import {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  SelectionMode,
  reconnectEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./canvas-flow.css";
import {
  CANVAS_HANDLES,
  canConnectCanvas,
  inferCanvasTargetHandle,
  isDuplicateCanvasConnection,
  nextCanvasKinds,
  type CanvasNodeKind,
} from "@/lib/canvas-graph";
import { canDropOnCanvas } from "@/lib/canvas-handoff";
import {
  DEFAULT_CANVAS_TITLE,
  normalizeCanvasTitle,
} from "@/lib/canvas-document";
import type { CreationHistoryItem } from "@/lib/creations";
import { useCurrentUser } from "@/lib/auth-context";
import { useAuthModal } from "@/components/auth/AuthModalProvider";
import CanvasTopBar from "./CanvasTopBar";
import CanvasToolbar, { CanvasEmptyState } from "./CanvasToolbar";
import CanvasSavedList from "./CanvasSavedList";
import { useCanvasLibrary } from "./CanvasLibraryPicker";
import PromptNode from "./nodes/PromptNode";
import ImageNode from "./nodes/ImageNode";
import VideoNode from "./nodes/VideoNode";
import SoundNode from "./nodes/SoundNode";
import CanvasEdge from "./nodes/CanvasEdge";
import { flowFromGraph, graphFromFlow } from "./canvas-persist";
import { dataFromLibraryItem, labeledDataForKind, type CanvasNodeData } from "./node-data";
import { CanvasActionsProvider } from "./canvas-actions";

const nodeTypes = {
  prompt: PromptNode,
  image: ImageNode,
  video: VideoNode,
  sound: SoundNode,
};

const edgeTypes = {
  canvas: CanvasEdge,
};

type CanvasNode = Node<CanvasNodeData, CanvasNodeKind>;

function kindOf(node: Node | undefined): CanvasNodeKind | null {
  const kind = (node?.data as CanvasNodeData | undefined)?.kind ?? node?.type;
  if (kind === "prompt" || kind === "image" || kind === "video" || kind === "sound") return kind;
  return null;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("textarea, input, select, [contenteditable='true']"));
}

function nodeFromLibrary(
  item: CreationHistoryItem,
  offset: number,
  existingLabels: Array<string | undefined | null>
): CanvasNode {
  const kind: CanvasNodeKind = item.mediaType === "video" ? "video" : "image";
  return {
    id: `${kind}-${crypto.randomUUID().slice(0, 8)}`,
    type: kind,
    position: { x: 96 + offset * 48, y: 88 + offset * 40 },
    data: dataFromLibraryItem(item, existingLabels),
    dragHandle: ".canvas-node-drag",
    selected: true,
  };
}

function withExclusiveSelection(nodes: CanvasNode[], selectedId: string): CanvasNode[] {
  return nodes.map((node) => {
    const selected = node.id === selectedId;
    return node.selected === selected ? node : { ...node, selected };
  });
}

function emptyFingerprint(): string {
  return fingerprintOf(DEFAULT_CANVAS_TITLE, [], []);
}

function fingerprintOf(
  title: string,
  nodes: CanvasNode[],
  edges: Edge[]
): string {
  return JSON.stringify({
    title: normalizeCanvasTitle(title),
    graph: graphFromFlow(nodes, edges, { x: 0, y: 0, zoom: 1 }),
  });
}

export default function CanvasWorkspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { getViewport, setViewport, deleteElements } = useReactFlow();
  const { status } = useCurrentUser();
  const { openSignInModal } = useAuthModal();
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [title, setTitle] = useState(DEFAULT_CANVAS_TITLE);
  const [canvasId, setCanvasId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [openList, setOpenList] = useState(false);
  const nodesRef = useRef(nodes);
  const edgesRef = useRef(edges);
  const titleRef = useRef(title);
  const canvasIdRef = useRef(canvasId);
  nodesRef.current = nodes;
  edgesRef.current = edges;
  titleRef.current = title;
  canvasIdRef.current = canvasId;
  const historyRef = useRef<{ nodes: CanvasNode[]; edges: Edge[] }[]>([]);
  const reconnectOk = useRef(true);
  const creationLinkRef = useRef(false);
  const lastSavedRef = useRef(emptyFingerprint());
  const persistedTitleRef = useRef(DEFAULT_CANVAS_TITLE);
  const { openLibrary, pickerOpen } = useCanvasLibrary();

  const fingerprint = useMemo(
    () => fingerprintOf(title, nodes, edges),
    [edges, nodes, title]
  );
  const dirty = fingerprint !== lastSavedRef.current;

  const pushHistory = useCallback(() => {
    historyRef.current.push({
      nodes: nodesRef.current,
      edges: edgesRef.current,
    });
    if (historyRef.current.length > 40) historyRef.current.shift();
  }, []);

  const confirmDiscard = useCallback(() => {
    if (fingerprint === lastSavedRef.current) return true;
    return window.confirm("You have unsaved changes. Discard them?");
  }, [fingerprint]);

  const applyCanvasUrl = useCallback(
    (id: string | null) => {
      const url = id ? `/tools/canvas?canvasId=${encodeURIComponent(id)}` : "/tools/canvas";
      router.replace(url, { scroll: false });
    },
    [router]
  );

  const resetCanvas = useCallback(() => {
    setCanvasId(null);
    setTitle(DEFAULT_CANVAS_TITLE);
    persistedTitleRef.current = DEFAULT_CANVAS_TITLE;
    setNodes([]);
    setEdges([]);
    historyRef.current = [];
    lastSavedRef.current = emptyFingerprint();
    setViewport({ x: 0, y: 0, zoom: 1 });
    applyCanvasUrl(null);
  }, [applyCanvasUrl, setEdges, setNodes, setViewport]);

  const loadCanvas = useCallback(
    async (id: string) => {
      const res = await fetch(`/api/canvas/${id}`);
      const data = (await res.json().catch(() => ({}))) as {
        canvas?: {
          id: string;
          title: string;
          graph: Parameters<typeof flowFromGraph>[0];
        };
        error?: string;
      };
      if (res.status === 401) {
        openSignInModal();
        return;
      }
      if (!res.ok || !data.canvas) {
        throw new Error(data.error || "Couldn't open that canvas.");
      }
      const flow = flowFromGraph(data.canvas.graph);
      setCanvasId(data.canvas.id);
      setTitle(data.canvas.title);
      persistedTitleRef.current = data.canvas.title;
      setNodes(flow.nodes);
      setEdges(flow.edges);
      historyRef.current = [];
      lastSavedRef.current = fingerprintOf(data.canvas.title, flow.nodes, flow.edges);
      requestAnimationFrame(() => setViewport(flow.viewport));
      applyCanvasUrl(data.canvas.id);
    },
    [applyCanvasUrl, openSignInModal, setEdges, setNodes, setViewport]
  );

  const addFromLibrary = useCallback(
    (item: CreationHistoryItem) => {
      if (!canDropOnCanvas(item)) return;
      pushHistory();
      setNodes((current) => {
        const next = nodeFromLibrary(
          item,
          current.length,
          current.map((node) => node.data.label)
        );
        return withExclusiveSelection([...current, next], next.id);
      });
    },
    [pushHistory, setNodes]
  );

  const attachLibraryRef = useCallback(
    (targetId: string, item: CreationHistoryItem) => {
      if (item.mediaType !== "image" || !canDropOnCanvas(item)) return;
      const target = nodesRef.current.find((node) => node.id === targetId);
      if (!target) return;
      const next = {
        ...nodeFromLibrary(
          item,
          nodesRef.current.length,
          nodesRef.current.map((node) => node.data.label)
        ),
        selected: false,
        position: { x: target.position.x - 400, y: target.position.y },
      };
      if (isDuplicateCanvasConnection(edgesRef.current, { source: next.id, target: targetId })) {
        return;
      }
      pushHistory();
      setNodes((current) => [...current, next]);
      setEdges((current) => [
        ...current,
        {
          id: `e-${crypto.randomUUID().slice(0, 8)}`,
          source: next.id,
          target: targetId,
          sourceHandle: CANVAS_HANDLES.out,
          targetHandle: CANVAS_HANDLES.in,
          type: "canvas",
        } as Edge,
      ]);
    },
    [pushHistory, setEdges, setNodes]
  );

  useEffect(() => {
    const id = searchParams.get("canvasId")?.trim();
    if (!id || id === canvasIdRef.current) return;
    void loadCanvas(id).catch((err) => {
      console.error(err);
    });
  }, [loadCanvas, searchParams]);

  useEffect(() => {
    if (creationLinkRef.current) return;
    if (searchParams.get("canvasId")?.trim()) return;
    const creationId = searchParams.get("creationId")?.trim();
    if (!creationId) return;
    creationLinkRef.current = true;
    void (async () => {
      try {
        const res = await fetch(
          `/api/creations/history?ids=${encodeURIComponent(creationId)}&limit=1`
        );
        const data = (await res.json()) as { items?: CreationHistoryItem[] };
        const item = data.items?.[0];
        if (!res.ok || !item) return;
        addFromLibrary(item);
      } catch {
        // Deep-link miss stays an empty canvas — the user can still pick from library.
      }
    })();
  }, [addFromLibrary, searchParams]);

  const handleSave = useCallback(async () => {
    if (status !== "authenticated") {
      openSignInModal();
      return;
    }
    const graph = graphFromFlow(nodesRef.current, edgesRef.current, getViewport());
    const nextTitle = titleRef.current;
    const nextFingerprint = fingerprintOf(nextTitle, nodesRef.current, edgesRef.current);
    if (nextFingerprint === lastSavedRef.current) return;

    setSaving(true);
    try {
      const id = canvasIdRef.current;
      const res = await fetch(id ? `/api/canvas/${id}` : "/api/canvas", {
        method: id ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle, graph }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        canvas?: { id: string; title: string };
        error?: string;
      };
      if (res.status === 401) {
        openSignInModal();
        return;
      }
      if (!res.ok || !data.canvas) {
        throw new Error(data.error || "Couldn't save this canvas.");
      }
      setCanvasId(data.canvas.id);
      setTitle(data.canvas.title);
      persistedTitleRef.current = data.canvas.title;
      lastSavedRef.current = fingerprintOf(data.canvas.title, nodesRef.current, edgesRef.current);
      applyCanvasUrl(data.canvas.id);
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Couldn't save this canvas.");
    } finally {
      setSaving(false);
    }
  }, [applyCanvasUrl, getViewport, openSignInModal, status]);

  const commitTitle = useCallback(
    async (raw: string) => {
      const nextTitle = normalizeCanvasTitle(raw);
      setTitle(nextTitle);
      if (nextTitle === persistedTitleRef.current) return;
      const id = canvasIdRef.current;
      if (!id) return;
      if (status !== "authenticated") {
        openSignInModal();
        return;
      }
      const nodesAtCommit = nodesRef.current;
      const edgesAtCommit = edgesRef.current;
      const wasClean =
        fingerprintOf(persistedTitleRef.current, nodesAtCommit, edgesAtCommit) ===
        lastSavedRef.current;
      try {
        const res = await fetch(`/api/canvas/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: nextTitle }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          canvas?: { id: string; title: string };
          error?: string;
        };
        if (res.status === 401) {
          openSignInModal();
          setTitle(persistedTitleRef.current);
          return;
        }
        if (!res.ok || !data.canvas) {
          throw new Error(data.error || "Couldn't rename this canvas.");
        }
        setTitle(data.canvas.title);
        persistedTitleRef.current = data.canvas.title;
        if (wasClean) {
          lastSavedRef.current = fingerprintOf(
            data.canvas.title,
            nodesAtCommit,
            edgesAtCommit
          );
        }
      } catch (err) {
        setTitle(persistedTitleRef.current);
        window.alert(err instanceof Error ? err.message : "Couldn't rename this canvas.");
      }
    },
    [openSignInModal, status]
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (fingerprintOf(titleRef.current, nodesRef.current, edgesRef.current) === lastSavedRef.current) {
        return;
      }
      e.preventDefault();
      e.returnValue = "";
    };
    const onKey = (event: KeyboardEvent) => {
      const save = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s" && !event.shiftKey;
      if (save) {
        event.preventDefault();
        void handleSave();
        return;
      }
      if (isTypingTarget(event.target)) return;
      const undo = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey;
      if (undo) {
        event.preventDefault();
        const prev = historyRef.current.pop();
        if (!prev) return;
        setNodes(prev.nodes);
        setEdges(prev.edges);
      }
    };
    window.addEventListener("beforeunload", warn);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("beforeunload", warn);
      window.removeEventListener("keydown", onKey);
    };
  }, [getViewport, handleSave, setEdges, setNodes]);

  const addNode = useCallback(
    (kind: CanvasNodeKind) => {
      pushHistory();
      setNodes((current) => {
        const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
        const offset = current.length;
        const next: CanvasNode = {
          id,
          type: kind,
          position: { x: 96 + offset * 48, y: 88 + offset * 40 },
          data: labeledDataForKind(
            kind,
            current.map((node) => node.data.label)
          ),
          dragHandle: ".canvas-node-drag",
          selected: true,
        };
        return withExclusiveSelection([...current, next], id);
      });
    },
    [pushHistory, setNodes]
  );

  const spawnFrom = useCallback(
    (sourceId: string, kind: CanvasNodeKind) => {
      const source = nodesRef.current.find((node) => node.id === sourceId);
      const sourceKind = kindOf(source);
      if (!source || !sourceKind) return;
      if (!nextCanvasKinds(sourceKind).includes(kind)) return;
      const targetHandle = inferCanvasTargetHandle(sourceKind);
      if (!targetHandle) return;
      if (
        !canConnectCanvas({
          sourceKind,
          targetKind: kind,
          targetHandle,
          sourceId,
          targetId: `${kind}-pending`,
        })
      ) {
        return;
      }

      const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
      const width = source.measured?.width ?? 340;
      pushHistory();
      setNodes((current) =>
        withExclusiveSelection(
          [
            ...current,
            {
              id,
              type: kind,
              position: { x: source.position.x + width + 80, y: source.position.y },
              data: labeledDataForKind(
                kind,
                current.map((node) => node.data.label)
              ),
              dragHandle: ".canvas-node-drag",
              selected: true,
            },
          ],
          id
        )
      );
      setEdges((current) => [
        ...current,
        {
          id: `e-${crypto.randomUUID().slice(0, 8)}`,
          source: sourceId,
          target: id,
          sourceHandle: CANVAS_HANDLES.out,
          targetHandle,
          type: "canvas",
        } as Edge,
      ]);
    },
    [pushHistory, setEdges, setNodes]
  );

  const openLibraryPicker = useCallback(() => {
    openLibrary({ onPick: addFromLibrary });
  }, [addFromLibrary, openLibrary]);

  const isValidConnection = useCallback((connection: Connection | Edge) => {
    const source = nodesRef.current.find((n) => n.id === connection.source);
    const target = nodesRef.current.find((n) => n.id === connection.target);
    const sourceKind = kindOf(source);
    const targetKind = kindOf(target);
    if (!sourceKind || !targetKind) return false;
    if (
      isDuplicateCanvasConnection(edgesRef.current, {
        source: connection.source,
        target: connection.target,
        id: "id" in connection ? connection.id : undefined,
      })
    ) {
      return false;
    }
    return canConnectCanvas({
      sourceKind,
      targetKind,
      targetHandle: connection.targetHandle,
      sourceId: connection.source ?? undefined,
      targetId: connection.target ?? undefined,
    });
  }, []);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) return;
      const source = nodesRef.current.find((n) => n.id === connection.source);
      const sourceKind = kindOf(source);
      if (!sourceKind || !connection.target) return;
      const targetHandle =
        connection.targetHandle || inferCanvasTargetHandle(sourceKind);
      if (!targetHandle) return;
      pushHistory();
      setEdges((current) => {
        if (
          isDuplicateCanvasConnection(current, {
            source: connection.source,
            target: connection.target,
          })
        ) {
          return current;
        }
        return [
          ...current,
          {
            id: `e-${crypto.randomUUID().slice(0, 8)}`,
            source: connection.source,
            target: connection.target,
            sourceHandle: connection.sourceHandle,
            targetHandle,
            type: "canvas",
          } as Edge,
        ];
      });
    },
    [isValidConnection, pushHistory, setEdges]
  );

  const onReconnectStart = useCallback(() => {
    reconnectOk.current = false;
  }, []);

  const onReconnect = useCallback(
    (oldEdge: Edge, newConnection: Connection) => {
      if (!isValidConnection(newConnection)) return;
      reconnectOk.current = true;
      const source = nodesRef.current.find((n) => n.id === newConnection.source);
      const sourceKind = kindOf(source);
      const targetHandle =
        newConnection.targetHandle ||
        (sourceKind ? inferCanvasTargetHandle(sourceKind) : oldEdge.targetHandle) ||
        null;
      pushHistory();
      setEdges((current) => {
        const updated = reconnectEdge(oldEdge, { ...newConnection, targetHandle }, current);
        if (!newConnection.target || !targetHandle) return updated;
        const moved = updated.find((edge) => edge.id === oldEdge.id);
        if (!moved) return updated;
        return updated.filter(
          (edge) =>
            edge.id === moved.id || edge.source !== moved.source || edge.target !== moved.target
        );
      });
    },
    [isValidConnection, pushHistory, setEdges]
  );

  const onReconnectEnd = useCallback(
    (_event: MouseEvent | TouchEvent, edge: Edge) => {
      if (!reconnectOk.current) {
        pushHistory();
        setEdges((current) => current.filter((item) => item.id !== edge.id));
      }
      reconnectOk.current = true;
    },
    [pushHistory, setEdges]
  );

  const handleNodesChange: typeof onNodesChange = useCallback(
    (changes) => {
      if (changes.some((change) => change.type === "remove")) pushHistory();
      onNodesChange(changes);
    },
    [onNodesChange, pushHistory]
  );

  const handleEdgesChange: typeof onEdgesChange = useCallback(
    (changes) => {
      if (changes.some((change) => change.type === "remove")) pushHistory();
      onEdgesChange(changes);
    },
    [onEdgesChange, pushHistory]
  );

  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);

  const deleteSelected = useCallback(() => {
    if (selectedNodes.length === 0) return;
    pushHistory();
    void deleteElements({ nodes: selectedNodes.map((node) => ({ id: node.id })) });
  }, [deleteElements, pushHistory, selectedNodes]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-N50">
      <CanvasTopBar
        title={title}
        dirty={dirty}
        saving={saving}
        onTitleChange={setTitle}
        onTitleCommit={(next) => void commitTitle(next)}
        onSave={() => void handleSave()}
        onOpen={() => {
          if (status !== "authenticated") {
            openSignInModal();
            return;
          }
          setOpenList(true);
        }}
      />
      <div className="relative min-h-0 flex-1">
        <CanvasActionsProvider value={{ spawnFrom, attachLibraryRef, pushHistory }}>
        <ReactFlow
          className="kk-canvas"
          nodes={nodes}
          edges={edges}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={onConnect}
          onReconnect={onReconnect}
          onReconnectStart={onReconnectStart}
          onReconnectEnd={onReconnectEnd}
          onEdgeDoubleClick={(_event, edge) => {
            pushHistory();
            setEdges((current) => current.filter((item) => item.id !== edge.id));
          }}
          isValidConnection={isValidConnection}
          connectOnClick={false}
          panOnScroll
          zoomOnScroll={false}
          zoomOnPinch
          panOnDrag={[0, 1, 2]}
          selectionMode={SelectionMode.Partial}
          selectionKeyCode="Shift"
          multiSelectionKeyCode={["Shift", "Meta"]}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          edgesReconnectable
          elevateEdgesOnSelect
          connectionRadius={36}
          reconnectRadius={20}
          colorMode="dark"
          fitView={false}
          minZoom={0.25}
          maxZoom={2}
          elevateNodesOnSelect
          deleteKeyCode={pickerOpen || openList ? null : ["Backspace", "Delete"]}
          defaultEdgeOptions={{
            type: "canvas",
            reconnectable: true,
            interactionWidth: 28,
            markerEnd: {
              type: MarkerType.ArrowClosed,
              width: 16,
              height: 16,
              color: "rgba(255,255,255,0.45)",
            },
          }}
          connectionLineStyle={{ stroke: "rgba(255,255,255,0.5)", strokeWidth: 1.75 }}
        >
          <Background gap={22} size={1.2} color="rgba(255,255,255,0.08)" />
          <Controls
            showInteractive={false}
            className="!overflow-hidden !rounded-xl !border !border-white/10 !bg-N50/90 !shadow-lg"
          />
          <MiniMap
            pannable
            zoomable
            className="!overflow-hidden !rounded-xl !border !border-white/10 !bg-N50/90"
            maskColor="rgba(0,0,0,0.55)"
            nodeColor="rgba(255,255,255,0.18)"
          />
        </ReactFlow>
        {nodes.length === 0 && (
          <CanvasEmptyState onAdd={addNode} onOpenLibrary={openLibraryPicker} />
        )}
        {selectedNodes.length > 0 && (
          <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2">
            <div className="pointer-events-auto flex items-center gap-2 rounded-2xl border border-white/10 bg-N50/90 px-3 py-1.5 shadow-lg shadow-black/40 backdrop-blur-md">
              <span className="text-xs text-text-secondary">
                {selectedNodes.length} selected
              </span>
              <button
                type="button"
                onClick={deleteSelected}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-text-primary transition-colors hover:bg-white/10"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
          </div>
        )}
        <CanvasToolbar onAdd={addNode} onOpenLibrary={openLibraryPicker} />
        </CanvasActionsProvider>
      </div>
      <CanvasSavedList
        open={openList}
        activeId={canvasId}
        onClose={() => setOpenList(false)}
        onSelect={(id) => {
          if (id === canvasId) {
            setOpenList(false);
            return;
          }
          if (!confirmDiscard()) return;
          setOpenList(false);
          void loadCanvas(id).catch((err) => {
            window.alert(err instanceof Error ? err.message : "Couldn't open that canvas.");
          });
        }}
        onNew={() => {
          if (!confirmDiscard()) return;
          setOpenList(false);
          resetCanvas();
        }}
        onDeleted={(id) => {
          if (id === canvasIdRef.current) resetCanvas();
        }}
        onRenamed={(id, nextTitle) => {
          if (id !== canvasIdRef.current) return;
          const nodesAtCommit = nodesRef.current;
          const edgesAtCommit = edgesRef.current;
          const wasClean =
            fingerprintOf(persistedTitleRef.current, nodesAtCommit, edgesAtCommit) ===
            lastSavedRef.current;
          setTitle(nextTitle);
          persistedTitleRef.current = nextTitle;
          if (wasClean) {
            lastSavedRef.current = fingerprintOf(nextTitle, nodesAtCommit, edgesAtCommit);
          }
        }}
      />
    </div>
  );
}
