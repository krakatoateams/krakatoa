"use client";

import { useEffect, useRef, useState } from "react";
import { FolderKanban, FolderOpen, ImageIcon, Loader2, Type, Video, Volume2 } from "lucide-react";
import { CANVAS_KIND_LABELS, type CanvasNodeKind } from "@/lib/canvas-graph";
import type { CanvasSummary } from "@/lib/canvas-document";

const EMPTY_SAVED_PREVIEW = 5;

function formatSavedUpdated(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

const ACTIONS: { kind: CanvasNodeKind; label: string; icon: typeof Type }[] = [
  { kind: "prompt", label: CANVAS_KIND_LABELS.prompt, icon: Type },
  { kind: "image", label: CANVAS_KIND_LABELS.image, icon: ImageIcon },
  { kind: "video", label: CANVAS_KIND_LABELS.video, icon: Video },
  { kind: "sound", label: CANVAS_KIND_LABELS.sound, icon: Volume2 },
];

const RAIL_BTN =
  "flex h-10 w-10 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary";

const EMPTY_CARD_CLASS =
  "pointer-events-auto w-full rounded-2xl border border-white/10 bg-N50/90 p-6 shadow-xl shadow-black/40 backdrop-blur-md";

export default function CanvasToolbar({
  onAdd,
  onOpenLibrary,
}: {
  onAdd: (kind: CanvasNodeKind) => void;
  onOpenLibrary: () => void;
}) {
  return (
    <div className="pointer-events-none absolute right-3 top-1/2 z-10 -translate-y-1/2 sm:right-4">
      <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-2xl border border-white/10 bg-N50/90 p-1.5 shadow-lg shadow-black/40 backdrop-blur-md">
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.kind}
              type="button"
              onClick={() => onAdd(action.kind)}
              title={`Add ${action.label}`}
              aria-label={`Add ${action.label} node`}
              className={RAIL_BTN}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
        <span className="my-0.5 h-px w-6 bg-white/10" aria-hidden />
        <button
          type="button"
          onClick={onOpenLibrary}
          title="Add from library"
          aria-label="Add from library"
          className={RAIL_BTN}
        >
          <FolderOpen className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function CanvasEmptyState({
  onAdd,
  onOpenLibrary,
  onOpenSaved,
  onSelectSaved,
}: {
  onAdd: (kind: CanvasNodeKind) => void;
  onOpenLibrary: () => void;
  onOpenSaved: () => void;
  onSelectSaved: (id: string) => void;
}) {
  const [saved, setSaved] = useState<CanvasSummary[]>([]);
  const [savedLoading, setSavedLoading] = useState(true);
  const loadGeneration = useRef(0);

  useEffect(() => {
    const generation = ++loadGeneration.current;
    const controller = new AbortController();

    void (async () => {
      setSavedLoading(true);
      try {
        const fetchList = () =>
          fetch("/api/canvas", { cache: "no-store", signal: controller.signal });

        let res = await fetchList();
        let data = (await res.json().catch(() => ({}))) as { canvases?: CanvasSummary[] };

        if (res.status === 401) {
          await new Promise((resolve) => window.setTimeout(resolve, 400));
          if (controller.signal.aborted || generation !== loadGeneration.current) return;
          res = await fetchList();
          data = (await res.json().catch(() => ({}))) as { canvases?: CanvasSummary[] };
        }

        if (controller.signal.aborted || generation !== loadGeneration.current) return;
        if (res.status === 401) {
          setSaved([]);
          return;
        }
        if (!res.ok) return;
        setSaved(data.canvases ?? []);
      } catch (err) {
        if (controller.signal.aborted || generation !== loadGeneration.current) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
      } finally {
        if (generation === loadGeneration.current) setSavedLoading(false);
      }
    })();

    return () => controller.abort();
  }, []);

  const preview = saved.slice(0, EMPTY_SAVED_PREVIEW);

  return (
    <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center overflow-y-auto p-6">
      <div className="flex w-full max-w-sm flex-col gap-3">
        <div className={`${EMPTY_CARD_CLASS} text-center`}>
          <p className="font-display text-lg font-semibold text-text-primary">Start new</p>
          <p className="mt-1 text-sm text-text-secondary">
            Drop a library still, or add a node and generate into it. Drag a handle to connect, or
            click it to add the next node.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {ACTIONS.map((action) => {
              const Icon = action.icon;
              return (
                <button
                  key={action.kind}
                  type="button"
                  onClick={() => onAdd(action.kind)}
                  className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-text-primary transition-colors hover:bg-white/10"
                >
                  <Icon className="h-4 w-4" />
                  {action.label}
                </button>
              );
            })}
            <button
              type="button"
              onClick={onOpenLibrary}
              className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm font-medium text-text-primary transition-colors hover:bg-white/10"
            >
              <FolderOpen className="h-4 w-4" />
              Library
            </button>
          </div>
        </div>

        {(savedLoading || preview.length > 0) && (
          <div className={EMPTY_CARD_CLASS}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="font-display text-lg font-semibold text-text-primary">Open last project</p>
              {saved.length > EMPTY_SAVED_PREVIEW ? (
                <button
                  type="button"
                  onClick={onOpenSaved}
                  className="shrink-0 text-xs font-medium text-text-secondary transition-colors hover:text-text-primary"
                >
                  View all
                </button>
              ) : null}
            </div>
            {savedLoading ? (
              <div className="flex items-center justify-center gap-2 py-2 text-sm text-text-secondary">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading…
              </div>
            ) : (
              <ul className="space-y-1.5">
                {preview.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => onSelectSaved(item.id)}
                      className="flex w-full items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left transition-colors hover:bg-white/10"
                    >
                      <FolderKanban className="h-4 w-4 shrink-0 text-text-secondary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-text-primary">
                          {item.title}
                        </span>
                        <span className="mt-0.5 block text-xs text-text-secondary">
                          {item.nodeCount} {item.nodeCount === 1 ? "node" : "nodes"}
                          {item.updatedAt ? ` · ${formatSavedUpdated(item.updatedAt)}` : ""}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
